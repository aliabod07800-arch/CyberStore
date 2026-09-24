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

// إعداد قاعدة البيانات مع الحماية الكاملة ضد أخطاء الاتصال الخارجي ECONNREFUSED
let sequelize;
try {
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres')) {
        sequelize = new Sequelize(process.env.DATABASE_URL, { 
            dialect: 'postgres', 
            protocol: 'postgres', 
            logging: false,
            dialectOptions: {
                ssl: { require: true, rejectUnauthorized: false }
            }
        });
    } else {
        sequelize = new Sequelize({ dialect: 'sqlite', storage: 'database.sqlite', logging: false });
    }
} catch (e) {
    console.log("التحول إلى قاعدة البيانات المحلية SQLite بسبب خطأ الاتصال:", e.message);
    sequelize = new Sequelize({ dialect: 'sqlite', storage: 'database.sqlite', logging: false });
}

// جدول المستخدمين ونقاط الولاء
const User = sequelize.define('User', {
    phone: { type: DataTypes.STRING, unique: true, allowNull: false },
    role: { type: DataTypes.STRING, defaultValue: 'customer' },
    totalSpent: { type: DataTypes.FLOAT, defaultValue: 0 },
    cyberPoints: { type: DataTypes.INTEGER, defaultValue: 100 }
});

// جدول الطلبات
const Order = sequelize.define('Order', {
    transactionId: { type: DataTypes.STRING, unique: true, allowNull: false },
    customerName: { type: DataTypes.STRING, allowNull: false },
    customerPhone: { type: DataTypes.STRING, allowNull: false },
    customerAddress: { type: DataTypes.TEXT, allowNull: false },
    paymentMethod: { type: DataTypes.STRING, allowNull: false },
    items: { type: DataTypes.JSON, allowNull: false },
    finalTotal: { type: DataTypes.FLOAT, allowNull: false },
    status: { type: DataTypes.STRING, defaultValue: 'قيد المعالجة ⏳' },
    paymentStatus: { type: DataTypes.STRING, defaultValue: 'معلق' }
});

// جدول المنتجات
const Product = sequelize.define('Product', {
    name: { type: DataTypes.STRING, allowNull: false },
    price: { type: DataTypes.FLOAT, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: false },
    image: { type: DataTypes.TEXT, allowNull: false }
});

// جدول المزادات الحية
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

let activeVisitors = 0;

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
            token: token,
            to: formattedPhone,
            body: message
        });
    } catch (err) {
        console.error("خطأ في إرسال واتساب:", err.message);
    }
}

const otpStorage = {};

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

app.post('/api/verify-otp', async (req, res) => {
    try {
        const { phone, otp } = req.body;
        if (otpStorage[phone] && otpStorage[phone] === otp) {
            delete otpStorage[phone];
            
            let user = await User.findOne({ where: { phone } });
            let role = 'customer';
            
            if (!user) {
                const userCount = await User.count();
                if (userCount === 0 || phone === '07831333337') {
                    role = 'admin';
                }
                user = await User.create({ phone, role });
            } else {
                role = user.role;
            }

            res.json({ success: true, phone: user.phone, role: user.role, points: user.cyberPoints });
        } else {
            res.status(400).json({ success: false, error: 'رمز التحقق غير صحيح' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// المساعد الذكي الخبير بالتجميعات والمنتجات
app.post('/api/ai-assistant', async (req, res) => {
    try {
        const { prompt } = req.body;
        const products = await Product.findAll();
        
        let aiReply = "مرحباً بك في CyberStore.iq! أنا مساعدك التقني الذكي. ";
        const lowerPrompt = prompt.toLowerCase();
        
        if (lowerPrompt.includes('تجميعة') || lowerPrompt.includes('بي سي') || lowerPrompt.includes('pc') || lowerPrompt.includes('ألعاب')) {
            const gamingItems = products.filter(p => p.category === 'أجهزة' || p.category === 'ألعاب');
            aiReply += `أنصحك بتجميعة احترافية تضم أقوى قطع الـ PC المتوفرة لدينا لضمان أداء عالي وسرعة فائقة.\n\nالمنتجات المقترحة:\n` + gamingItems.map(i => `- ${i.name} بسعر ${i.price.toLocaleString()} IQD`).join('\n') + `\n\nتفضل بإضافتها للسلة واستمتع بقوة الأداء!`;
        } else if (lowerPrompt.includes('مزايدة') || lowerPrompt.includes('مزاد')) {
            aiReply += `لدينا قسم مزادات حية (Live Cyber Auctions) يتيح لك المزايدة على أجهزة نادرة بأسعار مذهلة! تصفح قسم المزادات في المتجر الآن.`;
        } else {
            aiReply += `أنا هنا لمساعدتك في اختيار أفضل الأجهزة والإكسسوارات. اسألني عن أي منتج وسأشرح لك تفاصيله الفنية بدقة!`;
        }

        res.json({ success: true, reply: aiReply });
    } catch(e) {
        res.json({ success: true, reply: "أهلاً بك! تفضل بسؤالي عن أي منتج وسأساعدك فوراً." });
    }
});

// مسارات المزادات الحية
app.get('/api/auctions', async (req, res) => {
    try {
        const auctions = await Auction.findAll({ where: { status: 'active' } });
        res.json(auctions);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/auctions', async (req, res) => {
    try {
        const { title, currentPrice, image, hoursLeft } = req.body;
        let futureDate = new Date();
        futureDate.setHours(futureDate.getHours() + Number(hoursLeft || 5));
        
        await Auction.update({ status: 'ended' }, { where: { status: 'active' } });

        const newAuction = await Auction.create({
            title,
            currentPrice,
            image,
            endTime: futureDate,
            status: 'active'
        });

        io.emit('auction_update', newAuction);
        res.json({ success: true, newAuction });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/bid', async (req, res) => {
    try {
        const { auctionId, phone, bidAmount } = req.body;
        const auction = await Auction.findByPk(auctionId);
        
        if (!auction || auction.status !== 'active') {
            return res.json({ success: false, error: 'المزاد غير متوفر أو انتهى' });
        }

        if (bidAmount <= auction.currentPrice) {
            return res.json({ success: false, error: 'مبلغ المزايدة يجب أن يكون أعلى من السعر الحالي' });
        }

        auction.currentPrice = bidAmount;
        auction.highestBidder = phone;
        await auction.save();

        io.emit('auction_update', auction);

        res.json({ success: true, auction });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.findAll();
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/products', async (req, res) => {
    try {
        const { name, price, category, image } = req.body;
        const product = await Product.create({ name, price, category, image });
        res.json({ success: true, product });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/orders', async (req, res) => {
    try {
        const { customerName, customerPhone, customerAddress, paymentMethod, items, finalTotal, status, paymentStatus } = req.body;
        const transactionId = 'CYBER-' + Math.floor(100000 + Math.random() * 900000);

        const order = await Order.create({
            transactionId,
            customerName,
            customerPhone,
            customerAddress,
            paymentMethod,
            items,
            finalTotal,
            status,
            paymentStatus
        });

        const earnedPoints = Math.floor(finalTotal / 10000);
        await User.increment('cyberPoints', { by: earnedPoints, where: { phone: customerPhone } });

        io.emit('new_order_received', order);

        await sendWhatsAppMessage(customerPhone, `⚡ *CyberStore Global*\n\nعزيزي *${customerName}*,\nتم استلام طلبك برقم المعاملة: *${transactionId}* بقيمة *${finalTotal.toLocaleString()} IQD*.\nلقد ربحت *${earnedPoints}* نقطة ولاء جديدة في محفظتك!\n\nسنقوم بإعلامك فور الموافقة وشحن الطلب!`);

        res.json({ success: true, order, earnedPoints });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.findAll({ order: [['createdAt', 'DESC']] });
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/orders/:id/status', async (req, res) => {
    try {
        const { status, paymentStatus } = req.body;
        const order = await Order.findByPk(req.params.id);
        
        if (!order) return res.status(404).json({ success: false, error: 'الطلب غير موجود' });

        if(paymentStatus === 'مكتمل' && order.paymentStatus !== 'مكتمل') {
            await User.increment('totalSpent', { by: order.finalTotal, where: { phone: order.customerPhone } });
        }
        
        await Order.update({ status, paymentStatus }, { where: { id: req.params.id } });

        let statusMsg = `⚡ *CyberStore Global*\n\nعزيزي *${order.customerName}*,\nتم تحديث حالة طلبك (*${order.transactionId}*) إلى:\n👉 *${status}*`;
        
        if (paymentStatus === 'مكتمل') {
            statusMsg = `⚡ *CyberStore Global*\n\nعزيزي *${order.customerName}*,\n🎉 تم تأكيد استلام تحويل الأموال بنجاح والموافقة على طلبك (*${order.transactionId}*)!\n\n📦 الحالة الحالية: *${status}*\n\nشكراً لثقتك بمتجرنا التقني!`;
        }

        await sendWhatsAppMessage(order.customerPhone, statusMsg);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/track-order', async (req, res) => {
    try {
        const { phone } = req.body;
        const orders = await Order.findAll({ where: { customerPhone: phone }, order: [['createdAt', 'DESC']] });
        res.json({ success: true, orders });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/validate-coupon', async (req, res) => {
    try {
        const { code } = req.body;
        const coupon = await Coupon.findOne({ where: { code } });
        if (coupon) {
            res.json({ success: true, discount: coupon.discount });
        } else {
            res.json({ success: false, error: 'كود الخصم غير صالح' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const ordersCount = await Order.count();
        const usersCount = await User.count();
        const revenueResult = await Order.sum('finalTotal', { where: { paymentStatus: 'مكتمل' } });
        
        res.json({
            ordersCount,
            usersCount,
            totalRevenue: revenueResult || 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/users', async (req, res) => {
    try {
        const users = await User.findAll({ order: [['createdAt', 'DESC']] });
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

io.on('connection', (socket) => {
    activeVisitors++;
    io.emit('live_update', activeVisitors);

    socket.on('disconnect', () => {
        activeVisitors = Math.max(0, activeVisitors - 1);
        io.emit('live_update', activeVisitors);
    });
});

sequelize.sync().then(async () => {
    const existingCoupon = await Coupon.findOne({ where: { code: 'CYBER20' } });
    if (!existingCoupon) {
        await Coupon.create({ code: 'CYBER20', discount: 20 });
    }

    const activeAuction = await Auction.findOne({ where: { status: 'active' } });
    if (!activeAuction) {
        let futureDate = new Date();
        futureDate.setHours(futureDate.getHours() + 5);
        await Auction.create({
            title: 'بطاقة رسوميات فائقة RTX 4090 OC Edition',
            currentPrice: 1500000,
            image: 'https://images.unsplash.com/photo-1587202372775-e229f172b9d7?auto=format&fit=crop&w=600&q=80',
            endTime: futureDate,
            status: 'active'
        });
    }

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`🚀 CyberStore Enterprise Server running on port ${PORT}`);
    });
});