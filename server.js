const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(__dirname));

const dbURI = 'mongodb+srv://aliabod07800_db_user:CYBER12300@cluster0.vnvizqu.mongodb.net/cyberstore?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(dbURI, { serverSelectionTimeoutMS: 30000 })
    .then(() => console.log('✅ تم الاتصال بقاعدة البيانات السحابية بنجاح!'))
    .catch((err) => console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err.message));

// تحديث هيكل المنتج ليشمل التصنيف
const Product = mongoose.model('Product', new mongoose.Schema({
    name: String,
    price: String,
    image: String,
    category: { type: String, default: 'أخرى' },
    createdAt: { type: Date, default: Date.now }
}));

// تحديث هيكل الطلب ليشمل طريقة الدفع
const Order = mongoose.model('Order', new mongoose.Schema({
    customerName: String,
    customerPhone: String,
    customerAddress: String,
    paymentMethod: String,
    notes: String,
    items: Array,
    total: String,
    status: { type: String, default: 'قيد المعالجة' },
    createdAt: { type: Date, default: Date.now }
}));

const otpDatabase = {};

// مسارات المنتجات
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find().sort({ createdAt: -1 });
        res.json(products);
    } catch (err) { res.json([]); }
});

app.post('/api/products', async (req, res) => {
    try {
        const { name, price, image, category } = req.body;
        const newProduct = new Product({ name, price, image, category });
        await newProduct.save();
        res.json({ success: true, product: newProduct });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// مسارات الطلبات وتتبعها
app.post('/api/orders', async (req, res) => {
    try {
        const { customerName, customerPhone, customerAddress, paymentMethod, notes, items, total } = req.body;
        const newOrder = new Order({ customerName, customerPhone, customerAddress, paymentMethod, notes, items, total });
        await newOrder.save();
        res.json({ success: true, order: newOrder });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });
        res.json(orders);
    } catch (err) { res.json([]); }
});

// مسار تتبع الطلب الخاص بالعميل
app.post('/api/track-order', async (req, res) => {
    try {
        const { phone } = req.body;
        const userOrders = await Order.find({ customerPhone: phone }).sort({ createdAt: -1 });
        res.json({ success: true, orders: userOrders });
    } catch (err) { res.status(500).json({ success: false }); }
});

// إحصائيات لوحة التحكم
app.get('/api/stats', async (req, res) => {
    try {
        const ordersCount = await Order.countDocuments();
        const productsCount = await Product.countDocuments();
        const pendingOrders = await Order.countDocuments({ status: 'قيد المعالجة' });
        res.json({ ordersCount, productsCount, pendingOrders });
    } catch (err) { res.json({ ordersCount: 0, productsCount: 0, pendingOrders: 0 }); }
});

// مصادقة الواتساب
app.post('/api/send-otp', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'يرجى إرسال رقم الهاتف' });
    const otp = Math.floor(100000 + Math.random() * 900000);
    otpDatabase[phone] = otp;
    try {
        await axios.post('https://api.ultramsg.com/instance192290/messages/chat', {
            token: 'm0sarufyh678vh54', to: phone, body: `مرحباً بك في CyberStore ⚡\nكود التحقق الخاص بك هو: *${otp}*`
        });
        res.json({ success: true, message: 'تم إرسال الكود' });
    } catch (error) { res.status(500).json({ success: false, message: 'خطأ في الإرسال' }); }
});

app.post('/api/verify-otp', (req, res) => {
    const { phone, otp } = req.body;
    if (otpDatabase[phone] && otpDatabase[phone].toString() === otp.toString()) {
        delete otpDatabase[phone];
        if (phone === "+9647831333337" || phone === "9647831333337") {
            res.json({ success: true, role: 'admin', phone, message: 'مرحباً عبدالله' });
        } else {
            res.json({ success: true, role: 'user', phone, message: 'تم تسجيل الدخول' });
        }
    } else {
        res.status(401).json({ success: false, message: 'الكود غير صحيح' });
    }
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 الخادم يعمل على المنفذ: ${PORT}`));
