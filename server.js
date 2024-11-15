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

const mongoUri =
  process.env.MONGODB_URI ||
  "mongodb+srv://merylarnobit:tFHVJsQu4XyH3D6f@group1.otrlm.mongodb.net/";

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
    cookie: { secure: false }, // Set to true for HTTPS in production
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

// Define Token Schema and Model
const tokenSchema = new mongoose.Schema({
  email: { type: String, required: true },
  token: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 3600 },
});
const Token = mongoose.model("Token", tokenSchema);

// Define User Schema and Model
const userSchema = new mongoose.Schema({
  emaildb: { type: String, required: true },
  password: { type: String, required: true },
  resetKey: String,
  resetExpires: Date,
});
const User = mongoose.model("User", userSchema);

// Authentication Middleware
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    next();
  } else {
    res.status(401).json({ success: false, message: "Unauthorized access." });
  }
}

// Password Hashing
function hashPassword(password) {
  const saltRounds = 10;
  return bcrypt.hashSync(password, saltRounds);
}

// Generate Random String
function generateRandomString(length) {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// app.post("/forgot-password", async (req, res) => {
//   const { email } = req.body;
//   if (!email) return res.status(400).send("Email is required");

//   try {
//     let token = await Token.findOne({ email });
//     const resetToken = generateRandomString(32);

//     if (token) {
//       token.token = resetToken;
//       await token.save();
//     } else {
//       await new Token({ email, token: resetToken }).save();
//     }

//     return res
//       .status(200)
//       .json({ message: "Password reset token generated and saved" });
//   } catch (error) {
//     console.error("Error processing request:", error);
//     return res.status(500).json({ message: "Error processing request" });
//   }
// });

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Send Reset Code Email
async function sendResetCodeEmail(email, resetCode) {
  const msg = {
    to: email,
    from: "meryl.arnobit@gmail.com",
    subject: "Your Password Reset Code",
    text: `Your password reset code is: ${resetCode}`,
    html: `<p>Your password reset code is:</p><h3>${resetCode}</h3>`,
  };
  try {
    await sgMail.send(msg);
    console.log(`Reset code sent to ${email}`);
  } catch (error) {
    console.error("Error sending email:", error);
    throw new Error("Error sending reset code email");
  }
}

// Send Password Reset Code
// app.post("/send-password-reset", async (req, res) => {
//   const { email } = req.body;

//   try {
//     const user = await User.findOne({ emaildb: email });
//     if (!user)
//       return res
//         .status(404)
//         .json({ message: "No account with that email exists" });

//     const resetCode = generateRandomString(6);
//     user.resetKey = resetCode;
//     user.resetExpires = new Date(Date.now() + 3600000);
//     await user.save();

//     await sendResetCodeEmail(email, resetCode);
//     res.json({
//       message: "Password reset code sent",
//       redirectUrl: "/reset-password.html",
//     });
//   } catch (error) {
//     console.error("Error:", error);
//     res.status(500).json({ message: "Error processing request" });
//   }
// });

// Send Password Reset Code
// app.post("/send-password-reset", async (req, res) => {
//   const { email } = req.body;

//   if (!email) {
//     return res.status(400).json({ message: "Email is required" });
//   }

//   try {
//     // Search for the user in the 'userDB' database, inside the 'users' collection
//     const user = await usersCollection.findOne({ emaildb: email });

//     if (!user) {
//       return res
//         .status(404)
//         .json({ message: "No account with that email exists" });
//     }

//     // Generate a reset code
//     const resetCode = generateRandomString(6);

//     // Set the reset key and expiration for the reset code
//     user.resetKey = resetCode;
//     user.resetExpires = new Date(Date.now() + 3600000); // Expiry in 1 hour
//     await usersCollection.updateOne(
//       { _id: user._id },
//       { $set: { resetKey: resetCode, resetExpires: user.resetExpires } }
//     );

//     // Send the reset code via email (using SendGrid or your preferred service)
//     await sendResetCodeEmail(email, resetCode);

//     // Send a response indicating success and the redirect URL
//     res.json({
//       success: true,
//       message: "Password reset code sent. You will now be redirected.",
//       redirectUrl: "/reset-password.html",
//     });
//   } catch (error) {
//     console.error("Error sending password reset:", error);
//     res.status(500).json({ message: "Error processing request" });
//   }
// });

// app.post("/send-password-reset", async (req, res) => {
//   const { email } = req.body;

//   if (!email) {
//     return res.status(400).json({ message: "Email is required" });
//   }

//   try {
//     // Search for the user in the 'userDB' database, inside the 'users' collection
//     const user = await usersCollection.findOne({ emaildb: email });

//     if (!user) {
//       return res
//         .status(404)
//         .json({ message: "No account with that email exists" });
//     }

//     // Generate a reset code
//     const resetCode = generateRandomString(6);

//     // Set the reset key and expiration for the reset code
//     user.resetKey = resetCode;
//     user.resetExpires = new Date(Date.now() + 3600000); // Expiry in 1 hour
//     await usersCollection.updateOne(
//       { _id: user._id },
//       { $set: { resetKey: resetCode, resetExpires: user.resetExpires } }
//     );

//     // Send the reset code via email (using SendGrid or your preferred service)
//     await sendResetCodeEmail(email, resetCode);

//     res.json({
//       message: "Password reset code sent. You will now be redirected.",
//       redirectUrl: "/reset-password.html",
//     });
//   } catch (error) {
//     console.error("Error sending password reset:", error);
//     res.status(500).json({ message: "Error processing request" });
//   }
// });

// app.post("/send-password-reset", async (req, res) => {
//   const { email } = req.body;

//   if (!email) {
//     return res.status(400).json({ message: "Email is required" });
//   }

//   try {
//     // Search for the user in the 'userDB' database, inside the 'users' collection
//     const user = await usersCollection.findOne({ emaildb: email });

//     if (!user) {
//       return res
//         .status(404)
//         .json({ message: "No account with that email exists" });
//     }

//     // Generate a reset code
//     const resetCode = generateRandomString(6);

//     // Set the reset key and expiration for the reset code
//     user.resetKey = resetCode;
//     user.resetExpires = new Date(Date.now() + 3600000); // Expiry in 1 hour
//     await usersCollection.updateOne(
//       { _id: user._id },
//       { $set: { resetKey: resetCode, resetExpires: user.resetExpires } }
//     );

//     // Send the reset code via email (using SendGrid or your preferred service)
//     await sendResetCodeEmail(email, resetCode);

//     res.json({
//       message: "Password reset code sent",
//       redirectUrl: "/reset-password.html",
//     });
//   } catch (error) {
//     console.error("Error sending password reset:", error);
//     res.status(500).json({ message: "Error processing request" });
//   }
// });

app.post("/send-password-reset", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    // Search for the user in the 'userDB' database, inside the 'users' collection
    const user = await usersCollection.findOne({ emaildb: email });

    if (!user) {
      return res
        .status(404)
        .json({ message: "No account with that email exists" });
    }

    // Generate a reset code
    const resetCode = generateRandomString(6);

    // Set the reset key and expiration for the reset code
    user.resetKey = resetCode;
    user.resetExpires = new Date(Date.now() + 3600000); // Expiry in 1 hour
    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { resetKey: resetCode, resetExpires: user.resetExpires } }
    );

    // Send the reset code via email (using SendGrid or your preferred service)
    await sendResetCodeEmail(email, resetCode);

    res.json({
      message: "Password reset code sent",
      redirectUrl: "/reset-password.html",
    });
  } catch (error) {
    console.error("Error sending password reset:", error);
    res.status(500).json({ message: "Error processing request" });
  }
});

// Reset Password
// app.post("/reset-password", async (req, res) => {
//   const { resetKey, newPassword } = req.body;
//   try {
//     const user = await User.findOne({
//       resetKey,
//       resetExpires: { $gt: new Date() },
//     });
//     if (!user) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid or expired reset key" });
//     }

//     user.password = hashPassword(newPassword);
//     user.resetKey = null;
//     user.resetExpires = null;
//     await user.save();

//     return res.json({ success: true, message: "Password reset successfully" });
//   } catch (error) {
//     console.error("Error resetting password:", error);
//     res
//       .status(500)
//       .json({ success: false, message: "Error resetting password" });
//   }
// });

app.post("/reset-password", async (req, res) => {
  const { resetKey, newPassword } = req.body;

  try {
    // Use the usersCollection to find the user from the 'userDB' database
    const user = await usersCollection.findOne({
      resetKey,
      resetExpires: { $gt: new Date() }, // Ensure the reset key has not expired
    });

    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired reset key" });
    }

    // If user is found, hash the new password and update the user document
    user.password = hashPassword(newPassword); // Hash the new password
    user.resetKey = null; // Remove the reset key
    user.resetExpires = null; // Remove the reset expiry time
    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { password: user.password, resetKey: null, resetExpires: null } }
    );

    return res.json({
      success: true,
      message: "Password reset successfully. You may now log in.",
    });
  } catch (error) {
    console.error("Error resetting password:", error);
    res
      .status(500)
      .json({ success: false, message: "Error resetting password" });
  }
});

// Sign Up
app.post("/signup", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Email and password are required" });
  }

  try {
    const existingUser = await usersCollection.findOne({ emaildb: email });
    if (existingUser) {
      return res
        .status(400)
        .json({ success: false, message: "Email already registered" });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        success: false,
        message: "Password does not meet complexity requirements",
      });
    }

    const hashedPassword = hashPassword(password);
    await usersCollection.insertOne({
      emaildb: email,
      password: hashedPassword,
      createdAt: new Date(),
    });

    res.json({ success: true, message: "Account created successfully" });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

function isValidPassword(password) {
  const regex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
  return regex.test(password);
}

// Login Rate Limiter
const loginLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 50,
  message: "Too many login attempts, please try again after 30 minutes.",
  handler: function (req, res, next, options) {
    res
      .status(options.statusCode)
      .json({ success: false, message: options.message });
  },
});

app.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Email and password are required." });
    }
    if (!validator.isEmail(email)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid email format." });
    }

    const user = await usersCollection.findOne({ emaildb: email });
    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid email or password." });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid email or password." });
    }

    req.session.userId = user._id;
    req.session.email = user.emaildb;

    res.json({ success: true, message: "Login successful" });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Serve user details
// app.get("/user-details", (req, res) => {
//   if (req.session.email) {
//     return res.json({
//       success: true,
//       user: { email: req.session.email },
//     });
//   } else {
//     return res.json({ success: false, message: "User not logged in." });
//   }
// });

app.get("/user-details", (req, res) => {
  if (req.session.email) {
    return res.json({
      success: true,
      user: { email: req.session.email },
    });
  } else {
    return res.json({ success: false, message: "User not logged in." });
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res
        .status(500)
        .json({ success: false, message: "Failed to log out" });
    }
    res.clearCookie("connect.sid");
    res.json({ success: true, message: "Logged out successfully" });
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({ success: false, message: "Internal server error" });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
