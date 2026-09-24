const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Sequelize, DataTypes } = require('sequelize');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

let sequelize;
try {
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres')) {
        sequelize = new Sequelize(process.env.DATABASE_URL, { 
            dialect: 'postgres', 
            protocol: 'postgres', 
            logging: false,
            dialectOptions: { ssl: { require: true, rejectUnauthorized: false } }
        });
    } else {
        sequelize = new Sequelize({ dialect: 'sqlite', storage: 'database.sqlite', logging: false });
    }
} catch (e) {
    sequelize = new Sequelize({ dialect: 'sqlite', storage: 'database.sqlite', logging: false });
}

const STORE_CONFIG = {
    storeName: "CyberStore.iq Holographic Marketplace",
    merchantPhone: "9647831333337",
    zainCashWallet: "07831333337",
    shippingCost: 5000,
    loyaltyRewardRate: 0.05
};

app.get('/api/config', (req, res) => {
    res.json({ success: true, config: STORE_CONFIG });
});

const User = sequelize.define('User', {
    phone: { type: DataTypes.STRING, unique: true, allowNull: false },
    username: { type: DataTypes.STRING, unique: true, allowNull: false },
    role: { type: DataTypes.STRING, defaultValue: 'customer' },
    totalSpent: { type: DataTypes.FLOAT, defaultValue: 0 },
    cyberPoints: { type: DataTypes.INTEGER, defaultValue: 100 }
});

const Order = sequelize.define('Order', {
    transactionId: { type: DataTypes.STRING, unique: true, allowNull: false },
    customerName: { type: DataTypes.STRING, allowNull: false },
    customerPhone: { type: DataTypes.STRING, allowNull: false },
    customerAddress: { type: DataTypes.TEXT, allowNull: false },
    paymentMethod: { type: DataTypes.STRING, allowNull: false },
    receiptId: { type: DataTypes.STRING, defaultValue: 'نقداً' },
    items: { type: DataTypes.JSON, allowNull: false },
    finalTotal: { type: DataTypes.FLOAT, allowNull: false },
    status: { type: DataTypes.STRING, defaultValue: 'قيد المعالجة ⏳' },
    paymentStatus: { type: DataTypes.STRING, defaultValue: 'بانتظار التدقيق المالي 🔍' }
});

const Product = sequelize.define('Product', {
    name: { type: DataTypes.STRING, allowNull: false },
    price: { type: DataTypes.FLOAT, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: false },
    image: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.STRING, defaultValue: 'approved' },
    sellerPhone: { type: DataTypes.STRING, defaultValue: 'admin' }
});

const Auction = sequelize.define('Auction', {
    title: { type: DataTypes.STRING, allowNull: false },
    currentPrice: { type: DataTypes.FLOAT, allowNull: false },
    highestBidder: { type: DataTypes.STRING, defaultValue: 'لا يوجد مزايد بعد' },
    image: { type: DataTypes.TEXT, allowNull: false },
    endTime: { type: DataTypes.DATE, allowNull: false },
    status: { type: DataTypes.STRING, defaultValue: 'active' }
});

const Coupon = sequelize.define('Coupon', {
    code: { type: DataTypes.STRING, unique: true, allowNull: false },
    discount: { type: DataTypes.FLOAT, allowNull: false }
});

async function sendWhatsAppMessage(phone, message) {
    const instance = process.env.ULTRAMSG_INSTANCE;
    const token = process.env.ULTRAMSG_TOKEN;
    if (!instance || !token) {
        console.log(`[WhatsApp Simulation] To ${phone}: ${message}`);
        return;
    }
    try {
        let formattedPhone = phone.replace(/^0/, '964').replace(/^\+/, '');
        await axios.post(`https://api.ultramsg.com/${instance}/messages/chat`, {
            token: token, to: formattedPhone, body: message
        });
    } catch (err) {}
}

const otpStorage = {};

// إرسال الكود الحقيقي حصرياً عبر الواتساب دون قبول أكواد وهمية
app.post('/api/send-otp', async (req, res) => {
    try {
        const { phone } = req.body;
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        otpStorage[phone] = otp;
        await sendWhatsAppMessage(phone, `🔐 كود التحقق الخاص بك في CyberStore هو: *${otp}*\nلا تقم بمشاركته مع أي شخص.`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// التحقق الصارم من الـ OTP المرسل فعلياً عبر الواتساب
app.post('/api/verify-otp', async (req, res) => {
    try {
        const { phone, otp } = req.body;
        if (otpStorage[phone] && otpStorage[phone] === otp) {
            delete otpStorage[phone];
            let user = await User.findOne({ where: { phone } });
            const ADMIN_PHONE = '07831333337'; 
            let role = (phone === ADMIN_PHONE) ? 'admin' : 'customer';

            if (!user) {
                const randomId = Math.floor(1000 + Math.random() * 9000);
                const username = role === 'admin' ? 'CyberAdmin_VIP' : `CyberUser_${randomId}`;
                user = await User.create({ phone, username, role });
            } else if (user.role !== role) {
                user.role = role;
                await user.save();
            }
            res.json({ success: true, phone: user.phone, username: user.username, role: user.role, points: user.cyberPoints });
        } else {
            res.status(400).json({ success: false, error: 'رمز التحقق غير صحيح أو منتهي الصلاحية' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/ai-assistant', async (req, res) => {
    res.json({ success: true, reply: "أهلاً بك في منصة CyberStore الهولوغرافي! أنا مساعدك الذكي." });
});

app.get('/api/products', async (req, res) => {
    const products = await Product.findAll({ where: { status: 'approved' } });
    res.json(products);
});

app.get('/api/admin/products', async (req, res) => {
    const products = await Product.findAll();
    res.json(products);
});

app.post('/api/products', async (req, res) => {
    const { name, price, category, image, sellerPhone, status } = req.body;
    const product = await Product.create({ name, price, category, image, sellerPhone: sellerPhone || 'admin', status: status || 'approved' });
    io.emit('product_update');
    res.json({ success: true, product });
});

app.put('/api/products/:id/approve', async (req, res) => {
    await Product.update({ status: 'approved' }, { where: { id: req.params.id } });
    io.emit('product_update');
    res.json({ success: true });
});

app.delete('/api/products/:id', async (req, res) => {
    await Product.destroy({ where: { id: req.params.id } });
    io.emit('product_update');
    res.json({ success: true });
});

app.get('/api/auctions', async (req, res) => {
    const auctions = await Auction.findAll();
    res.json(auctions);
});

app.post('/api/auctions', async (req, res) => {
    const { title, currentPrice, image, hoursLeft } = req.body;
    let futureDate = new Date();
    futureDate.setHours(futureDate.getHours() + Number(hoursLeft || 5));
    const newAuction = await Auction.create({ title, currentPrice, image, endTime: futureDate, status: 'active' });
    io.emit('auction_update', newAuction);
    res.json({ success: true, newAuction });
});

app.put('/api/auctions/:id', async (req, res) => {
    const { title, currentPrice, status } = req.body;
    await Auction.update({ title, currentPrice, status }, { where: { id: req.params.id } });
    const updated = await Auction.findByPk(req.params.id);
    io.emit('auction_update', updated);
    res.json({ success: true });
});

app.delete('/api/auctions/:id', async (req, res) => {
    await Auction.destroy({ where: { id: req.params.id } });
    io.emit('auction_update', null);
    res.json({ success: true });
});

app.post('/api/bid', async (req, res) => {
    const { auctionId, phone, bidAmount } = req.body;
    const user = await User.findOne({ where: { phone } });
    const auction = await Auction.findByPk(auctionId);
    if (!auction || auction.status !== 'active') return res.json({ success: false, error: 'المزاد منتهي' });
    if (bidAmount <= auction.currentPrice) return res.json({ success: false, error: 'المبلغ يجب أن يكون أعلى' });
    auction.currentPrice = bidAmount;
    auction.highestBidder = user ? user.username : 'CyberUser_Anon';
    await auction.save();
    io.emit('auction_update', auction);
    res.json({ success: true, auction });
});

app.post('/api/orders', async (req, res) => {
    try {
        const { customerName, customerPhone, customerAddress, paymentMethod, receiptId, items, finalTotal } = req.body;
        const transactionId = 'CYBER-' + Math.floor(100000 + Math.random() * 900000);
        let initialPaymentStatus = paymentMethod === 'نقداً عند الاستلام' ? 'معلق عند التوصيل 💵' : 'بانتظار التدقيق المالي 🔍';

        const order = await Order.create({
            transactionId, customerName, customerPhone, customerAddress, paymentMethod,
            receiptId: receiptId || 'نقداً', items, finalTotal, status: 'قيد المعالجة ⏳', paymentStatus: initialPaymentStatus
        });

        io.emit('new_order_received', order);
        res.json({ success: true, order });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/orders', async (req, res) => {
    const orders = await Order.findAll({ order: [['createdAt', 'DESC']] });
    res.json(orders);
});

app.put('/api/orders/:id/status', async (req, res) => {
    try {
        const { status, paymentStatus } = req.body;
        const order = await Order.findByPk(req.params.id);
        if (!order) return res.status(404).json({ success: false, error: 'الطلب غير موجود' });

        let earnedPoints = 0;
        const ADMIN_PHONE = '07831333337';

        if(paymentStatus === 'مكتمل ✅' && order.paymentStatus !== 'مكتمل ✅') {
            await User.increment('totalSpent', { by: order.finalTotal, where: { phone: order.customerPhone } });
            if (order.customerPhone !== ADMIN_PHONE) {
                earnedPoints = Math.floor(order.finalTotal * STORE_CONFIG.loyaltyRewardRate);
                await User.increment('cyberPoints', { by: earnedPoints, where: { phone: order.customerPhone } });
            }
        }
        
        await Order.update({ status, paymentStatus }, { where: { id: req.params.id } });

        let statusMsg = `⚡ *${STORE_CONFIG.storeName}*\n\nعزيزي *${order.customerName}*,\n🎉 تم تأكيد طلبك برقم المعاملة (*${order.transactionId}*) بنجاح!\n\n📦 حالة الشحن: *${status}*\n💳 حالة الدفع: *${paymentStatus}*`;
        if (earnedPoints > 0) {
            statusMsg += `\n⭐ تمت إضافة *${earnedPoints}* نقطة ولاء إلى محفظتك!`;
        }
        await sendWhatsAppMessage(order.customerPhone, statusMsg);

        res.json({ success: true, earnedPoints });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/track-order', async (req, res) => {
    const { phone } = req.body;
    const orders = await Order.findAll({ where: { customerPhone: phone }, order: [['createdAt', 'DESC']] });
    res.json({ success: true, orders });
});

app.post('/api/validate-coupon', async (req, res) => {
    const { code } = req.body;
    const coupon = await Coupon.findOne({ where: { code } });
    if (coupon) res.json({ success: true, discount: coupon.discount });
    else res.json({ success: false, error: 'كود غير صالح' });
});

app.get('/api/stats', async (req, res) => {
    const ordersCount = await Order.count();
    const usersCount = await User.count();
    const revenueResult = await Order.sum('finalTotal', { where: { paymentStatus: 'مكتمل ✅' } });
    res.json({ ordersCount, usersCount, totalRevenue: revenueResult || 0 });
});

app.get('/api/users', async (req, res) => {
    const users = await User.findAll({ order: [['createdAt', 'DESC']] });
    res.json(users);
});

sequelize.sync().then(async () => {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`🚀 Holographic Server running on port ${PORT}`);
    });
});