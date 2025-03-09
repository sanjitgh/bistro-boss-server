const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config()
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const formData = require('form-data');
const Mailgun = require('mailgun.js');
const mailgun = new Mailgun(formData);
const port = process.env.PORT || 5000;
const axios = require('axios')

const mg = mailgun.client({ username: 'api', key: process.env.MAIL_GUN_API_KEY });

// midelwere
app.use(cors());
app.use(express.json());
app.use(express.urlencoded());


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rwhf0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        const usersCollection = client.db("menuDB").collection("users");
        const menuCollection = client.db("menuDB").collection("menu");
        const reviewsCollection = client.db("menuDB").collection("reviews");
        const cartCollection = client.db("menuDB").collection("carts");
        const paymentCollection = client.db("menuDB").collection("payments");

        // jwt related api
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '5h' });
            res.send({ token })
        })

        // middleware
        const verifyToken = (req, res, next) => {
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'unauthorized access' })
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
                if (error) {
                    return res.status(401).send({ message: 'unauthorized access' })
                }
                req.decoded = decoded;
                next();
            })
        }

        // verify admin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                res.status(403).send({ message: 'forbidden access' })
            }
            next()
        }

        // user related api
        app.get('/users/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbiden access' })
            }

            const query = { email: email };
            const user = await usersCollection.findOne(query);
            let admin = false;
            if (user) {
                admin = user?.role === "admin"
            }
            res.send({ admin })
        })

        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        })


        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email };
            const isExistingUser = await usersCollection.findOne(query);
            if (isExistingUser) {
                return res.send({ message: "User Already Exist!" })
            }
            const result = await usersCollection.insertOne(user);
            res.send(result);
        })


        app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    role: "admin"
                }
            }
            const result = await usersCollection.updateOne(filter, updatedDoc);
            res.send(result)
        })

        app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await usersCollection.deleteOne(query);
            res.send(result);
        })


        // menu
        app.post('/menu', verifyToken, verifyAdmin, async (req, res) => {
            const menu = req.body;
            const result = await menuCollection.insertOne(menu);
            res.send(result)
        })

        app.get('/menu', async (req, res) => {
            const menu = await menuCollection.find().toArray();
            res.send(menu)
        })

        app.get('/menu/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.findOne(query);
            res.send(result)
        })

        app.patch('/menu/:id', async (req, res) => {
            const id = req.params.id;
            const item = req.body;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    name: item.name,
                    category: item.category,
                    price: item.price,
                    recipe: item.recipe,
                    image: item.image
                }
            }
            const result = await menuCollection.updateOne(filter, updatedDoc);
            res.send(result);
        })

        app.delete('/menu/:id', verifyAdmin, verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.deleteOne(query);
            res.send(result);
        })

        // review & testimonial api
        app.get('/reviews', async (req, res) => {
            const menu = await reviewsCollection.find().toArray();
            res.send(menu)
        })

        // cart callection
        app.post('/carts', async (req, res) => {
            const cartItem = req.body;
            const result = await cartCollection.insertOne(cartItem);
            res.json(result)
        })

        app.get("/carts", async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        })

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartCollection.deleteOne(query);
            res.json(result)
        })

        // payment intent
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            })
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })

        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const paymentResult = await paymentCollection.insertOne(payment);
            // delete each item from the cart
            console.log('payment info', payment);
            const query = {
                _id: {
                    $in: payment.cartIds.map(id => new ObjectId(id))
                }
            }
            const deleteResult = await cartCollection.deleteMany(query);

            // send user email about payment confirmation
            mg.messages.create(process.env.MAIL_SENDING_DOMAIN, {
                from: "Excited User <mailgun@sandbox077ac2f55cba4def8c599ede346ebde3.mailgun.org>",
                to: ["sanjitkumarghosh0@gmail.com"],
                subject: "BistroBoss order confirmation",
                text: "Testing some Mailgun awesomeness!",
                html: `
                <h1>Thank you for your order</h1>
                 <h3>Your transaction id: <strong>${payment.transactionId}</strong>
                 </h3>
                `
            })
                .then(msg => console.log(msg)) // logs response data
                .catch(err => console.log(err)); // logs any error

            res.send({ paymentResult, deleteResult })
        })

        app.get('/payments/:email', verifyToken, async (req, res) => {
            const query = { email: req.params.email };
            if (req.params.email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' })
            };
            const result = await paymentCollection.find(query).toArray();
            res.send(result);
        })

        // create ssl commerz payment 
        app.post('/create-ssl-payment', async (req, res) => {
            const payment = req.body;
            const trxid = new ObjectId().toString();
            payment.transactionId = trxid

            const initiate = {
                store_id: "abc67cd90a7e423c",
                store_passwd: "abc67cd90a7e423c@ssl",
                total_amount: `${payment.price}`,
                currency: 'BDT',
                tran_id: trxid,
                success_url: 'https://bistro-boss-server-eight-hazel.vercel.app/success-payment',
                fail_url: 'https://bistro-boss-server-eight-hazel.vercel.app/fail',
                cancel_url: 'https://bistro-boss-server-eight-hazel.vercel.app/cancel',
                ipn_url: 'https://bistro-boss-server-eight-hazel.vercel.app/ipn-success-payment',
                shipping_method: 'Courier',
                product_name: 'Computer.',
                product_category: 'Electronic',
                product_profile: 'general',
                cus_name: 'Customer Name',
                cus_email: `${payment.email}`,
                cus_add1: 'Dhaka',
                cus_add2: 'Dhaka',
                cus_city: 'Dhaka',
                cus_state: 'Dhaka',
                cus_postcode: '1000',
                cus_country: 'Bangladesh',
                cus_phone: '01711111111',
                cus_fax: '01711111111',
                ship_name: 'Customer Name',
                ship_add1: 'Dhaka',
                ship_add2: 'Dhaka',
                ship_city: 'Dhaka',
                ship_state: 'Dhaka',
                ship_postcode: 1000,
                ship_country: 'Bangladesh',
            }

            const iniResponse = await axios({
                url: "https://sandbox.sslcommerz.com/gwprocess/v4/api.php",
                method: "POST",
                data: initiate,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            });

            const saveData = await paymentCollection.insertOne(payment);

            const gatewayUrl = iniResponse?.data?.GatewayPageURL

            res.send({ gatewayUrl })

        })

        app.post('/success-payment', async (req, res) => {
            // success payment data
            const paymentSuccess = req.body;

            // validation
            const { data } = await axios.get(`https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php?val_id=${paymentSuccess.val_id}&store_id=abc67cd90a7e423c&store_passwd=abc67cd90a7e423c@ssl&format=json`)


            if (data.status !== "VALID") {
                return res.send({ message: "Invalid Payment!" })
            }

            // update the payment
            const updatePayment = await paymentCollection.updateOne({ transactionId: data.tran_id }, {
                $set: {
                    status: "success"
                }
            })

            // delete each item from the cart
            const payment = await paymentCollection.findOne({
                transactionId: data.tran_id
            })
            const query = {
                _id: {
                    $in: payment.cartIds.map(id => new ObjectId(id))
                }
            }
            const deleteResult = await cartCollection.deleteMany(query);

            res.redirect('http://localhost:5173')
            // console.log("update payment", updatePayment);
        })

        // stats or analysis
        app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
            const users = await usersCollection.estimatedDocumentCount();
            const menuItems = await menuCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();

            // more efficient way to get total value not recomended reduce()
            const result = await paymentCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalRevenue: {
                            $sum: '$price'
                        }
                    }
                }
            ]).toArray();

            const revenue = result.length > 0 ? result[0].totalRevenue : 0;

            res.send({
                users,
                menuItems,
                orders,
                revenue
            })
        })


        // using aggregate pipeline
        app.get('/order-stats', verifyToken, verifyAdmin, async (req, res) => {
            const result = await paymentCollection.aggregate([
                {
                    $unwind: '$menuItemIds'
                },
                {
                    $lookup: {
                        from: 'menu',
                        localField: 'menuItemIds',
                        foreignField: '_id',
                        as: 'menuItems'
                    }
                },
                {
                    $unwind: '$menuItems'
                },
                {
                    $group: {
                        _id: '$menuItems.category',
                        quantity: { $sum: 1 },
                        revinue: { $sum: '$menuItems.price' }
                    }
                }


            ]).toArray();

            res.send(result)
        })

        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('server is runing!')
})

app.listen(port, () => {
    console.log(`runing on port : ${port}`);
})