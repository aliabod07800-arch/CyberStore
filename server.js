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

// إعداد بيئة PayPal
const clientId = 'BAAarCxsAmQmJjBovcJ_mgUqM2FkajysgS8f5y7HDhlW-V53-DYO8LiVgxWLZZlkRByf0gmNuNzFBDVRX4';
const clientSecret = 'ضع_الرقم_السري_الخاص_بك_هنا'; // تأكد من وضعه قبل الرفع لـ Render
const environment = new paypal.core.SandboxEnvironment(clientId, clientSecret);
const paypalClient = new paypal.core.PayPalHttpClient(environment);

// إعداد قاعدة بيانات MySQL (تأكد من متغيرات البيئة لـ Render)
const sequelize = new Sequelize('cyberstore_db', 'root', '', {
    host: 'localhost',
    dialect: 'mysql',
    logging: false
});

// ==========================================
// هياكل قواعد البيانات (Models)
// ==========================================
// 1. جدول المستخدمين (الجديد كلياً لتتبع الحسابات)
const User = sequelize.define('User', {
    phone: { type: DataTypes.STRING, unique: true, allowNull: false },
    role: { type: DataTypes.STRING, defaultValue: 'user' },
    totalSpent: { type: DataTypes.INTEGER, defaultValue: 0 },
    lastLogin: { type: DataTypes.DATE }
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
    items: { type: DataTypes.JSON },
    finalTotal: { type: DataTypes.INTEGER },
    status: { type: DataTypes.STRING, defaultValue: 'قيد المعالجة ⏳' }
});

const Coupon = sequelize.define('Coupon', {
    code: { type: DataTypes.STRING, unique: true, allowNull: false },
    discountPercent: { type: DataTypes.INTEGER, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
});

sequelize.sync({ alter: true }).then(async () => {
    console.log('✅ تم تهيئة مركز القيادة وقواعد البيانات بنجاح!');
    await Coupon.findOrCreate({ where: { code: 'CYBER20' }, defaults: { discountPercent: 20 } });
});

const otpDatabase = {};

// ==========================================
// رادار الزوار المباشر (Live Tracker)
// ==========================================
let liveVisitors = 0;
io.on('connection', (socket) => {
    liveVisitors++;
    io.emit('live_update', liveVisitors); // إرسال العدد الجديد للوحة الإدارة
    
    socket.on('disconnect', () => {
        liveVisitors--;
        io.emit('live_update', liveVisitors);
    });
});

// ==========================================
// مسارات واجهة برمجة التطبيقات (API)
// ==========================================
app.get('/api/products', async (req, res) => {
    const products = await Product.findAll({ include: [{ model: Review, as: 'reviews' }], order: [['createdAt', 'DESC']] });
    res.json(products);
});

app.post('/api/products', async (req, res) => {
    const newProduct = await Product.create(req.body);
    res.json({ success: true, product: newProduct });
});

app.post('/api/orders', async (req, res) => {
    try {
        const transactionId = 'TXN-' + Math.floor(1000000 + Math.random() * 9000000);
        const newOrder = await Order.create({ ...req.body, transactionId });
        
        // تحديث إجمالي مدفوعات العميل إذا كان الدفع مكتمل
        if(newOrder.paymentStatus === 'مكتمل') {
            await User.increment('totalSpent', { by: newOrder.finalTotal, where: { phone: newOrder.customerPhone } });
        }
        
        io.emit('new_order_received', newOrder);
        res.json({ success: true, order: newOrder });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/orders', async (req, res) => {
    const orders = await Order.findAll({ order: [['createdAt', 'DESC']] });
    res.json(orders);
});

app.put('/api/orders/:id/status', async (req, res) => {
    const { status, paymentStatus } = req.body;
    const order = await Order.findByPk(req.params.id);
    
    // إذا تحولت حالة الدفع إلى مكتمل، أضف المبلغ لرصيد العميل
    if(paymentStatus === 'مكتمل' && order.paymentStatus !== 'مكتمل') {
        await User.increment('totalSpent', { by: order.finalTotal, where: { phone: order.customerPhone } });
    }
    
    await Order.update({ status, paymentStatus }, { where: { id: req.params.id } });
    res.json({ success: true });
});

// مسار جلب قائمة العملاء للإدارة
app.get('/api/users', async (req, res) => {
    const users = await User.findAll({ order: [['totalSpent', 'DESC']] });
    res.json(users);
});

app.get('/api/stats', async (req, res) => {
    const ordersCount = await Order.count();
    const productsCount = await Product.count();
    const usersCount = await User.count();
    const totalRevenue = await Order.sum('finalTotal', { where: { paymentStatus: 'مكتمل' } }) || 0;
    res.json({ ordersCount, productsCount, usersCount, totalRevenue });
});

// ==========================================
// المصادقة الصارمة وتسجيل الحسابات
// ==========================================
app.post('/api/send-otp', async (req, res) => {
    const { phone } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000);
    otpDatabase[phone] = otp;
    try {
        await axios.post('https://api.ultramsg.com/instance192290/messages/chat', { token: 'm0sarufyh678vh54', to: phone, body: `CyberStore ⚡\nرمز الدخول: *${otp}*` });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/verify-otp', async (req, res) => {
    const { phone, otp } = req.body;
    if (otpDatabase[phone] && otpDatabase[phone].toString() === otp.toString()) {
        delete otpDatabase[phone];
        
        // تسجيل أو جلب المستخدم من قاعدة البيانات
        const [user, created] = await User.findOrCreate({ where: { phone } });
        user.lastLogin = new Date();
        
        // إعطاء صلاحية المدير لرقمك بأي صيغة كان
        if (phone === "+9647831333337" || phone === "07831333337" || phone === "9647831333337") {
            user.role = 'admin';
        }
        await user.save();

        res.json({ success: true, role: user.role, phone: user.phone });
    } else { res.status(401).json({ success: false }); }
});

// مسارات بايبال ...
app.post('/api/paypal/create-order', async (req, res) => {
    try {
        const request = new paypal.orders.OrdersCreateRequest();
        request.prefer("return=representation");
        request.requestBody({ intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'USD', value: req.body.totalInUSD.toString() } }] });
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

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });
server.listen(process.env.PORT || 3000, () => console.log(`🚀 الخادم يعمل على منفذ: 3000`));