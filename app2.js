const express = require("express");
const { MongoClient } = require("mongodb");
const amqp = require("amqplib/callback_api");
const util = require('util');
const swaggerJsDoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
const { config } = require("process");
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const CONFIG = {
    DB: {
        URI: "mongodb+srv://Rok:Feri123!@cluster0.bkl6gj5.mongodb.net/",
        NAME: "logsDB",
        COLLECTION: "logs"
    },
    RABBITMQ: {
        USER: "student",
        PASSWORD: "student123",
        HOST: "studentdocker.informatika.uni-mb.si",
        PORT: "5672",
        VHOST: "",
        EXCHANGE: 'upp-3',
        QUEUE: 'upp-3',
        ROUTING_KEY: 'zelovarnikey',
        get URL() {
            return util.format("amqp://%s:%s@%s:%s/%s", 
                this.USER, this.PASSWORD, this.HOST, this.PORT, this.VHOST);
        }
    }
};

let db, collection;

// Setup
setupSwagger();
connectToMongoDB();
setupRoutes();

// Server start
app.listen(3066, () => console.log("Server is running on port 3066"));

// Shutdown handler
process.on("SIGINT", shutdownHandler);

function setupSwagger() {
    const swaggerOptions = {
        definition: {
            openapi: '3.0.0',
            info: {
                title: 'Log Service API',
                version: '1.0.0',
                description: 'A log service API',
            },
            servers: [{ url: 'http://localhost:3066' }]
        },
        apis: ['app2.js'],
    };

    const swaggerDocs = swaggerJsDoc(swaggerOptions);
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));
}

function connectToMongoDB() {
    MongoClient.connect(CONFIG.DB.URI, { useUnifiedTopology: true })
        .then(client => {
            db = client.db(CONFIG.DB.NAME);
            collection = db.collection(CONFIG.DB.COLLECTION);
        })
        .catch(console.error);
}



function setupRoutes() {

    /**
     * @swagger
     * /logs:
     *   post:
     *     summary: Transfer logs
     *     responses:
     *       200:
     *         description: Logs transferred successfully
     */
    app.post("/logs", postLogsHandler(CONFIG.RABBITMQ));

    /**
     * @swagger
     * /logs/{dateFrom}/{dateTo}:
     *   get:
     *     summary: Retrieve logs between two dates
     *     parameters:
     *       - in: path
     *         name: dateFrom
     *         required: true
     *         schema:
     *           type: string
     *       - in: path
     *         name: dateTo
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: A list of logs
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   log:
     *                     type: string
     *                   timestamp:
     *                     type: string
     *                     format: date-time
     */
    app.get("/logs/:dateFrom/:dateTo", getLogsHandler);

    /**
     * @swagger
     * /logs:
     *   delete:
     *     summary: Delete all logs
     *     responses:
     *       200:
     *         description: Logs deleted successfully
     */
    app.delete("/logs", deleteLogsHandler);
}

function shutdownHandler() {
    console.log("Shutting down server...");
    process.exit();
}

function postLogsHandler({ URL, QUEUE }) {
    return (req, res) => {
        amqp.connect(URL, (error, connection) => {
            if (error) {
                return res.status(500).json({ error: "Failed to connect to RabbitMQ" });
            }

            connection.createChannel((error, channel) => {
                if (error) {
                    return res.status(500).json({ error: "Failed to create RabbitMQ channel" });
                }

                channel.assertQueue(QUEUE, { durable: true });

                // Consume messages
                channel.consume(QUEUE, (msg) => {
                    const log = msg.content.toString();
                    // Insert log into MongoDB
                    collection.insertOne({ log, timestamp: new Date() });
                    channel.ack(msg);
                }, { noAck: false });

                res.status(200).json({ message: "Logs transferred successfully" });
            });
        });
    };
}

function getLogsHandler(req, res) {
    const dateFrom = new Date(req.params.dateFrom);
    const dateTo = new Date(req.params.dateTo);

    collection.find({
        timestamp: {
            $gte: dateFrom,
            $lt: dateTo
        }
    }).toArray().then(logs => {
        res.status(200).json(logs);
    }).catch(error => {
        res.status(500).json({ error: "Failed to retrieve logs" });
    });
}

function deleteLogsHandler(req, res) {
    collection.deleteMany({})
        .then(() => {
            res.status(200).json({ message: "Logs deleted successfully" });
        })
        .catch(error => {
            res.status(500).json({ error: "Failed to delete logs" });
        });
}
