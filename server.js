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
// 1. إعداد بيئة PayPal
// ==========================================
const clientId = 'BAAarCxsAmQmJjBovcJ_mgUqM2FkajysgS8f5y7HDhlW-V53-DYO8LiVgxWLZZlkRByf0gmNuNzFBDVRX4';
const clientSecret = 'ضع_الرقم_السري_الخاص_بك_هنا'; // ⚠️ تنبيه: لا تنسَ وضع الـ Secret Key الخاص بحسابك هنا
const environment = new paypal.core.SandboxEnvironment(clientId, clientSecret);
const paypalClient = new paypal.core.PayPalHttpClient(environment);

// ==========================================
// 2. إعداد قاعدة بيانات MySQL (الكود الذكي السحابي)
// ==========================================
const dbURL = process.env.DATABASE_URL || 'mysql://root:@localhost:3306/cyberstore_db';

const sequelize = new Sequelize(dbURL, {
    dialect: 'mysql',
    logging: false,
    dialectOptions: process.env.DATABASE_URL ? {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    } : {}
});

// ==========================================
// 3. هياكل قواعد البيانات (Models)
// ==========================================
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
    console.log('✅ تم الاتصال بـ MySQL ومزامنة الجداول بنجاح!');
    await Coupon.findOrCreate({ where: { code: 'CYBER20' }, defaults: { discountPercent: 20 } });
}).catch(err => {
    console.error('❌ فشل الاتصال بقاعدة البيانات:', err);
});

const otpDatabase = {};

// ==========================================
// 4. رادار الزوار المباشر (Sockets)
// ==========================================
let liveVisitors = 0;
io.on('connection', (socket) => {
    liveVisitors++;
    io.emit('live_update', liveVisitors);
    
    socket.on('disconnect', () => {
        liveVisitors--;
        io.emit('live_update', liveVisitors);
    });
});

// ==========================================
// 5. مسارات واجهة برمجة التطبيقات (API)
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
        
        if(newOrder.paymentStatus === 'مكتمل') {
            await User.increment('totalSpent', { by: newOrder.finalTotal, where: { phone: newOrder.customerPhone } });
        }
        
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
        const order = await Order.findByPk(req.params.id);
        
        if(paymentStatus === 'مكتمل' && order.paymentStatus !== 'مكتمل') {
            await User.increment('totalSpent', { by: order.finalTotal, where: { phone: order.customerPhone } });
        }
        
        await Order.update({ status, paymentStatus }, { where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/api/users', async (req, res) => {
    try {
        const users = await User.findAll({ order: [['totalSpent', 'DESC']] });
        res.json(users);
    } catch (err) { res.status(500).json([]); }
});

app.get('/api/stats', async (req, res) => {
    try {
        const ordersCount = await Order.count();
        const productsCount = await Product.count();
        const usersCount = await User.count();
        const totalRevenue = await Order.sum('finalTotal', { where: { paymentStatus: 'مكتمل' } }) || 0;
        res.json({ ordersCount, productsCount, usersCount, totalRevenue });
    } catch (err) { res.json({ ordersCount: 0, productsCount: 0, usersCount: 0, totalRevenue: 0 }); }
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

// ==========================================
// 6. المصادقة وتسجيل الحسابات (الواتساب)
// ==========================================
app.post('/api/send-otp', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false });

    // 1. تحويل الرقم إلى الصيغة الدولية للواتساب (+964)
    let formattedPhone = phone.replace(/[\s\-]/g, '');
    if (formattedPhone.startsWith('07')) {
        formattedPhone = '+964' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('964')) {
        formattedPhone = '+' + formattedPhone;
    } else if (!formattedPhone.startsWith('+')) {
        formattedPhone = '+' + formattedPhone;
    }

    // 2. إنشاء الرمز السري
    const otp = Math.floor(100000 + Math.random() * 900000);
    otpDatabase[phone] = otp; 
    
    // طباعة احتياطية في السجلات (Logs)
    console.log(`\n🔑 طلب دخول جديد! الرقم: ${formattedPhone} | رمز الـ OTP هو: [ ${otp} ]\n`);

    // 3. قراءة المفاتيح السرية من منصة Render
    const instanceId = process.env.ULTRAMSG_INSTANCE; 
    const token = process.env.ULTRAMSG_TOKEN;

    if (!instanceId || !token) {
        console.error("❌ خطأ: مفاتيح UltraMsg غير موجودة في متغيرات البيئة.");
        return res.json({ success: true, warning: "WhatsApp API keys missing, check logs for OTP" });
    }

    try {
        // 4. إرسال رسالة الواتساب الحقيقية للعميل
        await axios.post(`https://api.ultramsg.com/${instanceId}/messages/chat`, { 
            token: token,
            to: formattedPhone,
            body: `CyberStore ⚡\nرمز الدخول الآمن: *${otp}*`
        });
        res.json({ success: true });
    } catch (error) { 
        console.error("❌ فشل إرسال الواتساب:", error.response ? error.response.data : error.message);
        res.json({ success: true, warning: "WhatsApp delivery failed, check logs for OTP" }); 
    }
});

app.post('/api/verify-otp', async (req, res) => {
    const { phone, otp } = req.body;
    if (otpDatabase[phone] && otpDatabase[phone].toString() === otp.toString()) {
        delete otpDatabase[phone];
        
        const [user, created] = await User.findOrCreate({ where: { phone } });
        user.lastLogin = new Date();
        
        // التحقق من أنك المدير (بأي صيغة أدخلت بها الرقم)
        if (phone === "+9647831333337" || phone === "07831333337" || phone === "9647831333337") {
            user.role = 'admin';
        }
        await user.save();

        res.json({ success: true, role: user.role, phone: user.phone });
    } else { res.status(401).json({ success: false }); }
});

// ==========================================
// 7. عمليات الدفع لبايبال (PayPal)
// ==========================================
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
server.listen(process.env.PORT || 3000, () => console.log(`🚀 الخادم يعمل على منفذ: ${process.env.PORT || 3000}`));