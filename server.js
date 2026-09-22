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
    .then(() => console.log('✅ تم الاتصال بقاعدة البيانات السحابية!'))
    .catch((err) => console.error('❌ خطأ في الاتصال:', err.message));

// هيكل المنتج مع المراجعات
const Product = mongoose.model('Product', new mongoose.Schema({
    name: String,
    price: String,
    image: String,
    category: { type: String, default: 'أخرى' },
    reviews: [{ userName: String, rating: Number, comment: String, date: { type: Date, default: Date.now } }],
    createdAt: { type: Date, default: Date.now }
}));

// هيكل الطلبات المتقدم
const Order = mongoose.model('Order', new mongoose.Schema({
    customerName: String,
    customerPhone: String,
    customerAddress: String,
    paymentMethod: String,
    notes: String,
    items: Array,
    total: String,
    discountApplied: { type: Boolean, default: false },
    status: { type: String, default: 'قيد المعالجة ⏳' }, // الحالات: قيد المعالجة، جاري الشحن، تم التوصيل
    createdAt: { type: Date, default: Date.now }
}));

// هيكل الكوبونات
const Coupon = mongoose.model('Coupon', new mongoose.Schema({
    code: String,
    discountPercent: Number,
    isActive: { type: Boolean, default: true }
}));

const otpDatabase = {};

// --- مسارات المنتجات والمراجعات ---
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
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/products/:id/review', async (req, res) => {
    try {
        const { userName, rating, comment } = req.body;
        const product = await Product.findById(req.params.id);
        product.reviews.push({ userName, rating, comment });
        await product.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- مسارات الطلبات وإدارتها ---
app.post('/api/orders', async (req, res) => {
    try {
        const newOrder = new Order(req.body);
        await newOrder.save();
        res.json({ success: true, order: newOrder });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });
        res.json(orders);
    } catch (err) { res.json([]); }
});

app.put('/api/orders/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        await Order.findByIdAndUpdate(req.params.id, { status });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/track-order', async (req, res) => {
    try {
        const { phone } = req.body;
        const userOrders = await Order.find({ customerPhone: phone }).sort({ createdAt: -1 });
        res.json({ success: true, orders: userOrders });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- نظام الكوبونات ---
app.post('/api/validate-coupon', async (req, res) => {
    try {
        const { code } = req.body;
        const coupon = await Coupon.findOne({ code: code, isActive: true });
        if (coupon) res.json({ success: true, discount: coupon.discountPercent });
        else res.json({ success: false, message: 'الكوبون غير صالح أو منتهي' });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- الإحصائيات ---
app.get('/api/stats', async (req, res) => {
    try {
        const ordersCount = await Order.countDocuments();
        const productsCount = await Product.countDocuments();
        const pendingOrders = await Order.countDocuments({ status: 'قيد المعالجة ⏳' });
        res.json({ ordersCount, productsCount, pendingOrders });
    } catch (err) { res.json({ ordersCount: 0, productsCount: 0, pendingOrders: 0 }); }
});

// --- المصادقة ---
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

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

// إنشاء كوبون افتراضي لأغراض الاختبار (CYBER20) يخصم 20%
Coupon.findOne({ code: 'CYBER20' }).then(c => {
    if(!c) new Coupon({ code: 'CYBER20', discountPercent: 20 }).save();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 الخادم جاهز على منفذ: ${PORT}`));
