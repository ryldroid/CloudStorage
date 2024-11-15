// VERSION TEST

const { MongoClient } = require("mongodb");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const sgMail = require("@sendgrid/mail");
const mongoose = require("mongoose");
const app = express();
const PORT = process.env.PORT || 3000;
const mongoUri =
  process.env.MONGODB_URI ||
  "mongodb+srv://merylarnobit:tFHVJsQu4XyH3D6f@group1.otrlm.mongodb.net/";
const client = new MongoClient(mongoUri);

// Connect to MongoDB
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

const bcrypt = require("bcrypt");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const validator = require("validator");

function hashPassword(password) {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(password, salt);
}

// Configure SendGrid API Key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));
app.use(express.json());
app.use(helmet());

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: mongoUri }),
    cookie: {
      secure: false,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 30 * 60 * 1000, // 30 minutes session expiry
    },
  })
);

// Login Rate Limiting
const loginLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 50,
  message: "Too many login attempts, please try again after 30 minutes.",
});

// Sign Up Route
app.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Email and password are required." });
    }

    const existingUser = await usersCollection.findOne({ emaildb: email });
    if (existingUser) {
      return res
        .status(400)
        .json({ success: false, message: "Email already registered." });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        success: false,
        message: "Password does not meet complexity requirements.",
      });
    }

    const hashedPassword = hashPassword(password);
    const newUser = {
      emaildb: email,
      password: hashedPassword,
      createdAt: new Date(),
    };
    const insertResult = await usersCollection.insertOne(newUser);

    if (insertResult.acknowledged) {
      res.json({ success: true, message: "Account created successfully!" });
    } else {
      res
        .status(500)
        .json({ success: false, message: "Failed to create account." });
    }
  } catch (error) {
    console.error("Error creating account:", error);
    res
      .status(500)
      .json({ success: false, message: "An internal server error occurred." });
  }
});

// Login Route
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
    req.session.email = user.emaildb; // Use emaildb here for session
    req.session.role = user.role;
    await req.session.save();

    res.json({ success: true, message: "Login successful!" });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ success: false, message: "Error during login." });
  }
});

// Middleware for authentication
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    next();
  } else {
    res.status(401).json({ success: false, message: "Unauthorized access." });
  }
}

// Fetch User Details Route
app.get("/user-details", isAuthenticated, async (req, res) => {
  try {
    const email = req.session.email;
    if (!email) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized access." });
    }

    const user = await usersCollection.findOne(
      { emaildb: email },
      { projection: { emaildb: 1 } }
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    res.json({ success: true, user: { email: user.emaildb } });
  } catch (error) {
    console.error("Error fetching user details:", error);
    res
      .status(500)
      .json({ success: false, message: "Error fetching user details." });
  }
});

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendResetCodeEmail(email, resetCode) {
  const msg = {
    to: email,
    from: "meryl.arnobit@gmail.com",
    subject: "Your Password Reset Code",
    text: `Your password reset code is ${resetCode}.`,
    html: `<p>Your password reset code is <strong>${resetCode}</strong>.</p>`,
  };
  try {
    await sgMail.send(msg);
    console.log("Reset code email sent to:", email);
  } catch (error) {
    console.error("Error sending reset code email:", error);
    throw new Error("Failed to send reset email");
  }
}

// Send Reset Code Route
app.post("/send-password-reset", async (req, res) => {
  const { email } = req.body;
  try {
    const user = await usersCollection.findOne({ emaildb: email });
    if (!user) {
      res.status(404).json({
        success: false,
        message: "No account with that email address exists.",
      });
      return;
    }
    const resetCode = generateCode();
    const updateResult = await usersCollection.updateOne(
      { emaildb: email },
      {
        $set: {
          resetKey: resetCode,
          resetExpires: new Date(Date.now() + 3600000),
        },
      }
    );
    if (updateResult.modifiedCount === 1) {
      await sendResetCodeEmail(email, resetCode);
      res.json({ success: true, redirectUrl: "/reset-password.html" });
    } else {
      res
        .status(500)
        .json({ success: false, message: "Failed to set reset code." });
    }
  } catch (error) {
    console.error("Error processing your request", error);
    res
      .status(500)
      .json({ success: false, message: "Error processing your request" });
  }
});

// Reset Password Route
app.post("/reset-password", async (req, res) => {
  const { resetKey, newPassword } = req.body;
  try {
    const user = await usersCollection.findOne({
      resetKey: resetKey,
      resetExpires: { $gt: new Date() },
    });
    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired reset key." });
    }
    const hashedPassword = hashPassword(newPassword);
    const updateResult = await usersCollection.updateOne(
      { _id: user._id },
      {
        $set: {
          password: hashedPassword,
          resetKey: null,
          resetExpires: null,
        },
      }
    );
    if (updateResult.modifiedCount === 1) {
      res.json({
        success: true,
        message: "Your password has been successfully reset.",
      });
    } else {
      res
        .status(500)
        .json({ success: false, message: "Password reset failed." });
    }
  } catch (error) {
    console.error("Error resetting password:", error);
    res
      .status(500)
      .json({ success: false, message: "Error resetting password" });
  }
});

// Logout Route
app.post("/logout", (req, res) => {
  if (!req.session.userId) {
    return res
      .status(400)
      .json({ success: false, message: "No user is logged in." });
  }

  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
      return res
        .status(500)
        .json({ success: false, message: "Logout failed." });
    }
    res.clearCookie("connect.sid");
    res.json({ success: true, message: "Logged out successfully." });
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// // VERSION TEST 2.0

// const { MongoClient } = require("mongodb");
// require("dotenv").config();
// const express = require("express");
// const cors = require("cors");
// const bodyParser = require("body-parser");
// const sgMail = require("@sendgrid/mail");
// const mongoose = require("mongoose");
// const app = express();
// const PORT = process.env.PORT || 3000;
// const mongoUri =
//   process.env.MONGODB_URI ||
//   "mongodb+srv://merylarnobit:tFHVJsQu4XyH3D6f@group1.otrlm.mongodb.net/"; // Use your MongoDB URI
// const client = new MongoClient(mongoUri);

// // await client.connect();
// const database = client.db("userDB");
// let usersCollection;
// async function connectToDatabase() {
//   try {
//     await client.connect();
//     console.log("Connected to MongoDB");
//     const database = client.db("userDB");
//     usersCollection = database.collection("users");
//   } catch (err) {
//     console.error("Failed to connect to MongoDB", err);
//     process.exit(1);
//   }
// }
// connectToDatabase();

// const bcrypt = require("bcrypt");
// const session = require("express-session");
// const MongoStore = require("connect-mongo");
// const rateLimit = require("express-rate-limit");
// const helmet = require("helmet");
// const validator = require("validator");

// function hashPassword(password) {
//   const salt = bcrypt.genSaltSync(10);
//   return bcrypt.hashSync(password, salt);
// }

// // function hashPassword(password) {
// //   const saltRounds = 10;
// //   return bcrypt.hashSync(password, saltRounds);
// // }

// // Configure SendGrid API Key
// sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// // Middleware
// app.use(bodyParser.urlencoded({ extended: true }));
// app.use(bodyParser.json());
// app.use(express.static("public")); // Serve static files
// app.use(express.static(__dirname + "/public"));

// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
// app.use(helmet());

// app.use(
//   session({
//     secret: process.env.SESSION_SECRET,
//     resave: false,
//     saveUninitialized: false,
//     store: MongoStore.create({ mongoUrl: mongoUri }),

//     cookie: {
//       secure: false, // Set to true if using HTTPS
//       httpOnly: true,
//       sameSite: "lax",
//       maxAge: 30 * 60 * 1000, // 30 minutes session expiry
//     },
//   })
// );

// // Generate Random String Function
// function generateRandomString(length) {
//   const characters =
//     "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
//   let result = "";
//   for (let i = 0; i < length; i++) {
//     result += characters.charAt(Math.floor(Math.random() * characters.length));
//   }
//   return result;
// }

// // MongoDB connection using the URI from .env
// mongoose
//   .connect(process.env.MONGO_URI)
//   .then(() => {
//     console.log("Connected to MongoDB");
//   })
//   .catch((error) => {
//     console.error("MongoDB connection error:", error);
//   });

// // Token schema and model
// const tokenSchema = new mongoose.Schema({
//   email: { type: String, required: true },
//   token: { type: String, required: true },
//   password: { type: String, required: false },
//   createdAt: { type: Date, default: Date.now, expires: 3600 }, // Expires in 1 hour
// });
// const Token = mongoose.model("Token", tokenSchema);

// // Forgot Password Endpoint
// // Forgot Password Endpoint
// app.post("/forgot-password", async (req, res) => {
//   const { email } = req.body;
//   if (!email) {
//     return res.status(400).send("Email is required");
//   }
//   try {
//     const resetToken = generateRandomString(32);
//     let existingToken = await Token.findOne({ email });

//     if (existingToken) {
//       existingToken.token = resetToken;
//       await existingToken.save();
//     } else {
//       // Set default password as 'Password123'
//       await new Token({
//         email,
//         token: resetToken,
//         password: "Password123",
//       }).save();
//     }

//     const msg = {
//       to: email,
//       from: "meryl.arnobit@gmail.com",
//       subject: "Password Reset Request",
//       text: `Your password reset token is: ${resetToken}`,
//       html: `<p>Your password reset token is:</p><h3>${resetToken}</h3>`,
//     };

//     await sgMail.send(msg);
//     res.status(200).send("Password reset email sent");
//   } catch (error) {
//     console.error("Error sending email:", error);
//     res.status(500).send("Error finding or updating token");
//   }
// });

// // Sign Up Route
// function isValidPassword(password) {
//   // Example: Password must be at least 8 characters, contain letters and numbers
//   const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
//   return passwordRegex.test(password);
// }

// // adjust for login attempts
// const loginLimiter = rateLimit({
//   windowMs: 30 * 60 * 1000, // 30 minutes
//   max: 5, // Limit each IP to 5 requests per windowMs
//   message: "Too many login attempts, please try again after 30 minutes.",
//   handler: function (req, res, next, options) {
//     res
//       .status(options.statusCode)
//       .json({ success: false, message: options.message });
//   },
// });

// app.post("/signup", async (req, res) => {
//   const { email, password } = req.body;
//   try {
//     // Check if user already exists
//     if (!email || !password) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Email and password are required." });
//     }
//     const existingUser = await usersCollection.findOne({ email: email });
//     if (existingUser) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Email already registered." });
//     }
//     // Validate password strength (optional)
//     if (!isValidPassword(password)) {
//       return res.status(400).json({
//         success: false,
//         message: "Password does not meet complexity requirements.",
//       });
//     }
//     // Hash the password
//     const hashedPassword = hashPassword(password);
//     // Create the new user object
//     const newUser = {
//       emaildb: email,
//       password: hashedPassword,
//       createdAt: new Date(),
//     };
//     // Insert the new user into the database
//     const insertResult = await usersCollection.insertOne(newUser);
//     // Check if the insert operation was successful
//     if (insertResult.acknowledged) {
//       res.json({ success: true, message: "Account created successfully!" });
//     } else {
//       res
//         .status(500)
//         .json({ success: false, message: "Failed to create account." });
//     }
//   } catch (error) {
//     console.error("Error creating account:", error.stack || error);
//     res
//       .status(500)
//       .json({ success: false, message: "An internal server error occurred." });
//   }
// });

// app.post("/login", loginLimiter, async (req, res) => {
//   const { email, password } = req.body;
//   try {
//     // Input validation
//     if (!email || !password) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Email and password are required." });
//     }
//     if (!validator.isEmail(email)) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid email format." });
//     }
//     // Fetch user
//     const user = await usersCollection.findOne({ emaildb: email });
//     if (!user) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid email or password." });
//     }
//     // Account lockout check
//     if (user.accountLockedUntil && user.accountLockedUntil > new Date()) {
//       const remainingTime = Math.ceil(
//         (user.accountLockedUntil - new Date()) / 60000
//       );

//       return res.status(403).json({
//         success: false,
//         message: `Account is locked.

//   Try again in ${remainingTime} minutes.`,
//       });
//     }
//     // Password verification
//     const passwordMatch = await bcrypt.compare(password, user.password);
//     if (!passwordMatch) {
//       // Handle failed attempts
//       let invalidAttempts = (user.invalidLoginAttempts || 0) + 1;
//       let updateFields = { invalidLoginAttempts: invalidAttempts };
//       if (invalidAttempts >= 3) {
//         // Lock account
//         updateFields.accountLockedUntil = new Date(Date.now() + 30 * 60 * 1000);

//         updateFields.invalidLoginAttempts = 0;
//         await usersCollection.updateOne(
//           { _id: user._id },
//           { $set: updateFields }
//         );

//         return res.status(403).json({
//           success: false,
//           message:
//             "Account is locked due to multiple failed login attempts. Please try again after 30 minutes.",
//         });
//       } else {
//         await usersCollection.updateOne(
//           { _id: user._id },
//           { $set: updateFields }
//         );

//         return res
//           .status(400)
//           .json({ success: false, message: "Invalid email or password." });
//       }
//     }

//     // Successful login
//     await usersCollection.updateOne(
//       { _id: user._id },
//       {
//         $set: {
//           invalidLoginAttempts: 0,
//           accountLockedUntil: null,

//           lastLoginTime: new Date(),
//         },
//       }
//     );
//     req.session.userId = user._id;
//     req.session.email = user.email;
//     req.session.role = user.role;
//     req.session.studentIDNumber = user.studentIDNumber;
//     await new Promise((resolve, reject) => {
//       req.session.save((err) => {
//         if (err) return reject(err);
//         resolve();
//       });
//     });
//     res.json({ success: true, role: user.role, message: "Login successful!" });
//   } catch (error) {
//     console.error("Error during login:", error);
//     res.status(500).json({ success: false, message: "Error during login." });
//   }
// });

// function isAuthenticated(req, res, next) {
//   if (req.session && req.session.userId) {
//     next();
//   } else {
//     res.status(401).json({ success: false, message: "Unauthorized access." });
//   }
// }

// app.get("/dashboard", isAuthenticated, (req, res) => {
//   res.sendFile(__dirname + "/public/dashboard.html");
// });

// app.post("/logout", async (req, res) => {
//   if (!req.session.userId) {
//     return res
//       .status(400)
//       .json({ success: false, message: "No user is logged in." });
//   }
//   try {
//     req.session.destroy((err) => {
//       if (err) {
//         console.error("Error destroying session:", err);
//         return res
//           .status(500)
//           .json({ success: false, message: "Logout failed." });
//       }
//       res.clearCookie("connect.sid");
//       // Prevent caching
//       res.setHeader(
//         "Cache-Control",
//         "no-store, no-cache, must-revalidate, proxy-revalidate"
//       );

//       res.setHeader("Pragma", "no-cache");
//       res.setHeader("Expires", "0");
//       res.setHeader("Surrogate-Control", "no-store");
//       return res.json({ success: true, message: "Logged out successfully." });
//     });
//   } catch (error) {
//     console.error("Error during logout:", error);
//     return res
//       .status(500)
//       .json({ success: false, message: "Failed to log out." });
//   }
// });

// // Start the server
// app.listen(PORT, () => {
//   console.log(`Server is running on port ${PORT}`);
// });
