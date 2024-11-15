require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const validator = require("validator");
const sgMail = require("@sendgrid/mail");
const mongoose = require("mongoose");
const { MongoClient } = require("mongodb");
const bcrypt = require("bcrypt");

const mongoUri = process.env.MONGODB_URI;
const client = new MongoClient(mongoUri);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname + "/public"));
app.use("/node_modules", express.static("node_modules"));
app.use(helmet());
app.use(cors());

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: mongoUri }),
    cookie: { secure: false },
  })
);

// MongoDB setup
let usersCollection;

async function connectToDatabase() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");
    const database = client.db("userDB");
    usersCollection = database.collection("users");
  } catch (err) {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  }
}

connectToDatabase();

// Mongoose Connection
mongoose
  .connect(mongoUri)
  .then(() => console.log("Mongoose connected"))
  .catch((err) => console.log("Mongoose connection error:", err));

// Example function fix
app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).send("Email is required");

  try {
    let token = await Token.findOne({ email });
    const resetToken = generateRandomString(32);

    if (token) {
      token.token = resetToken;
      await token.save();
    } else {
      await new Token({ email, token: resetToken }).save();
    }

    return res
      .status(200)
      .json({ message: "Password reset token generated and saved" });
  } catch (error) {
    console.error("Error processing request:", error);
    return res.status(500).json({ message: "Error processing request" });
  }
});
