const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(__dirname));

// 1. الاتصال بقاعدة البيانات السحابية (MongoDB)
const dbURI = 'mongodb+srv://aliabod07800_db_user:2vmOHty4u0hf7hFT@cluster0.vnvizqu.mongodb.net/cyberstore?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(dbURI)
    .then(() => console.log('✅ تم الاتصال بقاعدة البيانات السحابية بنجاح!'))
    .catch((err) => console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err.message));

// 2. هياكل البيانات
const productSchema = new mongoose.Schema({
    name: String,
    price: String,
    image: String,
    createdAt: { type: Date, default: Date.now }
});
const Product = mongoose.model('Product', productSchema);

const orderSchema = new mongoose.Schema({
    items: Array,
    total: String,
    createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

const otpDatabase = {};

// 3. مسارات المنتجات (مع حماية لكي لا يتعطل الموقع لو حدث خطأ)
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find().sort({ createdAt: -1 });
        res.json(products);
    } catch (err) {
        console.error("خطأ جلب المنتجات:", err.message);
        res.json([]); // إرجاع مصفوفة فارغة بدلاً من خطأ 500
    }
});

app.post('/api/products', async (req, res) => {
    try {
        const { name, price, image } = req.body;
        const newProduct = new Product({ name, price, image });
        await newProduct.save();
        res.json({ success: true, product: newProduct });
    } catch (err) {
        console.error("خطأ حفظ المنتج:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. مسارات الطلبات
app.post('/api/orders', async (req, res) => {
    try {
        const { items, total } = req.body;
        const newOrder = new Order({ items, total });
        await newOrder.save();
        res.json({ success: true, order: newOrder });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });
        res.json(orders);
    } catch (err) {
        res.json([]);
    }
});

// 5. مسار إرسال الواتساب
app.post('/api/send-otp', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'يرجى إرسال رقم الهاتف' });

    const otp = Math.floor(100000 + Math.random() * 900000);
    otpDatabase[phone] = otp;

    const instanceId = 'instance192290';
    const token = 'm0sarufyh678vh54';
    const message = `مرحباً بك في CyberStore 🎮\nكود التحقق الخاص بك هو: *${otp}*`;
    
    try {
        await axios.post(`https://api.ultramsg.com/${instanceId}/messages/chat`, {
            token: token, to: phone, body: message
        });
        res.json({ success: true, message: 'تم إرسال كود التحقق عبر الواتساب' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء إرسال رسالة الواتساب' });
    }
});

// 6. التحقق من الكود والدخول
app.post('/api/verify-otp', (req, res) => {
    const { phone, otp } = req.body;

    if (otpDatabase[phone] && otpDatabase[phone].toString() === otp.toString()) {
        delete otpDatabase[phone];
        
        if (phone === "+9647831333337" || phone === "9647831333337") {
            res.json({ success: true, role: 'admin', message: 'مرحباً عبدالله، تم تسجيل دخولك كمدير' });
        } else {
            res.json({ success: true, role: 'user', message: 'تم تسجيل الدخول بنجاح كمستخدم!' });
        }
    } else {
        res.status(401).json({ success: false, message: 'كود التحقق غير صحيح' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 الخادم يعمل بنجاح على المنفذ: ${PORT}`));