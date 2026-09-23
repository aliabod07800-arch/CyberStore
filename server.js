const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');
const http = require('http');
const { Sequelize, DataTypes } = require('sequelize');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

// ==========================================
// 1. إعداد الاتصال بقاعدة بيانات MySQL
// ==========================================
// استبدل 'cyberstore_db', 'root', 'password' ببيانات قاعدة MySQL الخاصة بك
const sequelize = new Sequelize('cyberstore_db', 'root', '', {
    host: 'localhost', // أو رابط استضافة MySQL السحابية (مثل PlanetScale أو AWS RDS)
    dialect: 'mysql',
    logging: false // لإيقاف طباعة استعلامات SQL في الطرفية
});

// ==========================================
// 2. بناء هياكل الجداول (Models)
// ==========================================
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

// العلاقة: المنتج الواحد يمتلك عدة مراجعات
Product.hasMany(Review, { as: 'reviews', onDelete: 'CASCADE' });
Review.belongsTo(Product);

const Order = sequelize.define('Order', {
    customerName: { type: DataTypes.STRING, allowNull: false },
    customerPhone: { type: DataTypes.STRING, allowNull: false },
    customerAddress: { type: DataTypes.TEXT, allowNull: false },
    paymentMethod: { type: DataTypes.STRING },
    notes: { type: DataTypes.TEXT },
    items: { type: DataTypes.JSON }, // تخزين المنتجات كمصفوفة JSON
    total: { type: DataTypes.STRING },
    discountApplied: { type: DataTypes.BOOLEAN, defaultValue: false },
    status: { type: DataTypes.STRING, defaultValue: 'قيد المعالجة ⏳' }
});

const Coupon = sequelize.define('Coupon', {
    code: { type: DataTypes.STRING, unique: true, allowNull: false },
    discountPercent: { type: DataTypes.INTEGER, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
});

// مزامنة الجداول مع قاعدة البيانات (إنشاؤها إذا لم تكن موجودة)
sequelize.sync({ alter: true })
    .then(async () => {
        console.log('✅ تم الاتصال بقاعدة بيانات MySQL ومزامنة الجداول بنجاح!');
        // إنشاء كوبون افتراضي إذا لم يكن موجوداً
        await Coupon.findOrCreate({
            where: { code: 'CYBER20' },
            defaults: { discountPercent: 20 }
        });
    })
    .catch(err => console.error('❌ خطأ في الاتصال بقاعدة بيانات MySQL:', err));

const otpDatabase = {};

// ==========================================
// 3. مسارات واجهة برمجة التطبيقات (API Routes)
// ==========================================

app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.findAll({
            include: [{ model: Review, as: 'reviews' }],
            order: [['createdAt', 'DESC']]
        });
        res.json(products);
    } catch (err) { res.status(500).json([]); }
});

app.post('/api/products', async (req, res) => {
    try {
        const newProduct = await Product.create(req.body);
        res.json({ success: true, product: newProduct });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/products/:id/review', async (req, res) => {
    try {
        await Review.create({ ...req.body, ProductId: req.params.id });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/orders', async (req, res) => {
    try {
        const newOrder = await Order.create(req.body);
        io.emit('new_order_received', newOrder); // إشعار لحظي للوحة الإدارة
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
        const { status } = req.body;
        await Order.update({ status }, { where: { id: req.params.id } });
        const updatedOrder = await Order.findByPk(req.params.id);
        io.emit('order_status_updated', updatedOrder); // إشعار لحظي للعميل
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/track-order', async (req, res) => {
    try {
        const { phone } = req.body;
        const userOrders = await Order.findAll({ 
            where: { customerPhone: phone },
            order: [['createdAt', 'DESC']]
        });
        res.json({ success: true, orders: userOrders });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/validate-coupon', async (req, res) => {
    try {
        const { code } = req.body;
        const coupon = await Coupon.findOne({ where: { code: code, isActive: true } });
        if (coupon) res.json({ success: true, discount: coupon.discountPercent });
        else res.json({ success: false, message: 'الكوبون غير صالح أو منتهي' });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/api/stats', async (req, res) => {
    try {
        const ordersCount = await Order.count();
        const productsCount = await Product.count();
        const pendingOrders = await Order.count({ where: { status: 'قيد المعالجة ⏳' } });
        res.json({ ordersCount, productsCount, pendingOrders });
    } catch (err) { res.json({ ordersCount: 0, productsCount: 0, pendingOrders: 0 }); }
});

// ==========================================
// 4. مسارات المصادقة (OTP)
// ==========================================
app.post('/api/send-otp', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'يرجى إرسال رقم الهاتف' });
    const otp = Math.floor(100000 + Math.random() * 900000);
    otpDatabase[phone] = otp;
    try {
        await axios.post('https://api.ultramsg.com/instance192290/messages/chat', {
            token: 'm0sarufyh678vh54', to: phone, body: `CyberStore ⚡\nرمز الدخول الآمن: *${otp}*`
        });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/verify-otp', (req, res) => {
    const { phone, otp } = req.body;
    if (otpDatabase[phone] && otpDatabase[phone].toString() === otp.toString()) {
        delete otpDatabase[phone];
        if (phone === "+9647831333337" || phone === "9647831333337") {
            res.json({ success: true, role: 'admin', phone });
        } else {
            res.json({ success: true, role: 'user', phone });
        }
    } else {
        res.status(401).json({ success: false });
    }
});

// ==========================================
// 5. إعداد الاتصال اللحظي وتهيئة الخادم
// ==========================================
io.on('connection', (socket) => {
    console.log('⚡ اتصال جديد عبر WebSockets:', socket.id);
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 الخادم الحي جاهز على منفذ: ${PORT}`));