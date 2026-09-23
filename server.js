const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');
const http = require('http');
const { Sequelize, DataTypes } = require('sequelize');
const paypal = require('@paypal/checkout-server-sdk');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

// ==========================================
// 1. إعداد بيئة PayPal (تم دمج Client ID الخاص بك)
// ==========================================
const clientId = 'BAAarCxsAmQmJjBovcJ_mgUqM2FkajysgS8f5y7HDhlW-V53-DYO8LiVgxWLZZlkRByf0gmNuNzFBDVRX4';
const clientSecret = 'ELBYnF__PdhSX_eR3nSa19QdHYA47mglkPSUEwz9pYj5nU1h6f2VYt9oZ3g3ucK0JI5bhEWbJnDhCFwu';
const environment = new paypal.core.SandboxEnvironment(clientId, clientSecret);
const paypalClient = new paypal.core.PayPalHttpClient(environment);

// ==========================================
// 2. إعداد قاعدة بيانات MySQL
// ==========================================
const sequelize = new Sequelize('cyberstore_db', 'root', '', {
    host: 'localhost',
    dialect: 'mysql',
    logging: false
});

const Product = sequelize.define('Product', {
    name: { type: DataTypes.STRING, allowNull: false },
    price: { type: DataTypes.STRING, allowNull: false },
    image: { type: DataTypes.STRING },
    category: { type: DataTypes.STRING, defaultValue: 'أخرى' }
});

const Review = sequelize.define('Review', {
    userName: { type: DataTypes.STRING, defaultValue: 'مستخدم مجهول' },
    rating: { type: DataTypes.INTEGER, allowNull: false },
    comment: { type: DataTypes.TEXT }
});

Product.hasMany(Review, { as: 'reviews', onDelete: 'CASCADE' });
Review.belongsTo(Product);

const Order = sequelize.define('Order', {
    transactionId: { type: DataTypes.STRING, unique: true, allowNull: false },
    customerName: { type: DataTypes.STRING, allowNull: false },
    customerPhone: { type: DataTypes.STRING, allowNull: false },
    customerAddress: { type: DataTypes.TEXT, allowNull: false },
    paymentMethod: { type: DataTypes.STRING },
    paymentStatus: { type: DataTypes.STRING, defaultValue: 'معلق' },
    notes: { type: DataTypes.TEXT },
    items: { type: DataTypes.JSON },
    subtotal: { type: DataTypes.INTEGER },
    discountAmount: { type: DataTypes.INTEGER, defaultValue: 0 },
    shippingFee: { type: DataTypes.INTEGER, defaultValue: 5000 },
    finalTotal: { type: DataTypes.INTEGER },
    status: { type: DataTypes.STRING, defaultValue: 'قيد المعالجة ⏳' }
});

const Coupon = sequelize.define('Coupon', {
    code: { type: DataTypes.STRING, unique: true, allowNull: false },
    discountPercent: { type: DataTypes.INTEGER, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
});

sequelize.sync({ alter: true }).then(async () => {
    console.log('✅ تم الاتصال بـ MySQL ومزامنة الجداول بنجاح!');
    await Coupon.findOrCreate({ where: { code: 'CYBER20' }, defaults: { discountPercent: 20 } });
});

const otpDatabase = {};

// ==========================================
// 3. مسارات واجهة برمجة التطبيقات (API)
// ==========================================
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.findAll({ include: [{ model: Review, as: 'reviews' }], order: [['createdAt', 'DESC']] });
        res.json(products);
    } catch (err) { res.status(500).json([]); }
});

app.post('/api/products', async (req, res) => {
    try {
        const newProduct = await Product.create(req.body);
        res.json({ success: true, product: newProduct });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/products/:id/review', async (req, res) => {
    try {
        await Review.create({ ...req.body, ProductId: req.params.id });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/orders', async (req, res) => {
    try {
        const transactionId = 'TXN-' + Math.floor(1000000 + Math.random() * 9000000);
        const newOrder = await Order.create({ ...req.body, transactionId });
        io.emit('new_order_received', newOrder);
        res.json({ success: true, order: newOrder });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.findAll({ order: [['createdAt', 'DESC']] });
        res.json(orders);
    } catch (err) { res.status(500).json([]); }
});

app.put('/api/orders/:id/status', async (req, res) => {
    try {
        const { status, paymentStatus } = req.body;
        const updateData = {};
        if (status) updateData.status = status;
        if (paymentStatus) updateData.paymentStatus = paymentStatus;
        await Order.update(updateData, { where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/track-order', async (req, res) => {
    try {
        const userOrders = await Order.findAll({ where: { customerPhone: req.body.phone }, order: [['createdAt', 'DESC']] });
        res.json({ success: true, orders: userOrders });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/validate-coupon', async (req, res) => {
    try {
        const coupon = await Coupon.findOne({ where: { code: req.body.code, isActive: true } });
        if (coupon) res.json({ success: true, discount: coupon.discountPercent });
        else res.json({ success: false, message: 'الكوبون غير صالح' });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/api/stats', async (req, res) => {
    try {
        const ordersCount = await Order.count();
        const productsCount = await Product.count();
        const pendingOrders = await Order.count({ where: { status: 'قيد المعالجة ⏳' } });
        const totalRevenue = await Order.sum('finalTotal', { where: { paymentStatus: 'مكتمل' } }) || 0;
        res.json({ ordersCount, productsCount, pendingOrders, totalRevenue });
    } catch (err) { res.json({ ordersCount: 0, productsCount: 0, pendingOrders: 0, totalRevenue: 0 }); }
});

// ==========================================
// 4. مسارات PayPal للعمليات المالية
// ==========================================
app.post('/api/paypal/create-order', async (req, res) => {
    try {
        const request = new paypal.orders.OrdersCreateRequest();
        request.prefer("return=representation");
        request.requestBody({
            intent: 'CAPTURE',
            purchase_units: [{ amount: { currency_code: 'USD', value: req.body.totalInUSD.toString() } }]
        });
        const order = await paypalClient.execute(request);
        res.json({ id: order.result.id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/paypal/capture-order', async (req, res) => {
    try {
        const request = new paypal.orders.OrdersCaptureRequest(req.body.orderID);
        request.requestBody({});
        const capture = await paypalClient.execute(request);
        res.json({ success: true, capture });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 5. المصادقة والـ OTP
// ==========================================
app.post('/api/send-otp', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false });
    const otp = Math.floor(100000 + Math.random() * 900000);
    otpDatabase[phone] = otp;
    try {
        await axios.post('https://api.ultramsg.com/instance192290/messages/chat', { token: 'm0sarufyh678vh54', to: phone, body: `CyberStore ⚡\nرمز الدخول: *${otp}*` });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/verify-otp', (req, res) => {
    const { phone, otp } = req.body;
    if (otpDatabase[phone] && otpDatabase[phone].toString() === otp.toString()) {
        delete otpDatabase[phone];
        if (phone === "+9647831333337" || phone === "9647831333337") res.json({ success: true, role: 'admin', phone });
        else res.json({ success: true, role: 'user', phone });
    } else { res.status(401).json({ success: false }); }
});

io.on('connection', (socket) => { console.log('⚡ اتصال حي للوحات التحكم:', socket.id); });

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });
server.listen(process.env.PORT || 3000, () => console.log(`🚀 الخادم يعمل على منفذ: 3000`));