// models/db.model.js
// Kết nối MongoDB tập trung, dùng lại cho toàn bộ app

require('dotenv').config();
const mongoose = require('mongoose');

mongoose.set("strictQuery", true);

const uri = process.env.MONGO_URI;
if (!uri) {
    throw new Error("[DB] Thiếu MONGO_URI trong .env");
}

let connectPromise = null;

function connectDB() {
    if (mongoose.connection.readyState === 1) {
        return Promise.resolve(mongoose);
    }

    if (connectPromise) {
        return connectPromise;
    }

    connectPromise = mongoose
        .connect(uri)
        .then(() => {
            console.log("[DB] Connected");
            return mongoose;
        })
        .catch((err) => {
            connectPromise = null;
            console.log("[DB] Lỗi kết nối cơ sở dữ liệu");
            console.log(err);
            throw err;
        });

    return connectPromise;
}

mongoose.connection.on("error", (err) => {
    console.log("[DB] Connection error");
    console.log(err);
});

connectDB();

module.exports = { mongoose, connectDB };