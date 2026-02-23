import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-for-dev";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

// In-memory DB for demo purposes
const usersDb: Record<string, { email: string, credits: number, isPremium: boolean }> = {};
const SPECIAL_EMAILS = ['amliyarsachin248@gmail.com', 'amaliyarmanu5@gmail.com', 'sachinamliyar15@gmail.com', 'robotlinkan@gmail.com'];

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());

  // API Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // --- OAuth Routes ---
  app.get("/api/auth/url", (req, res) => {
    const redirectUri = `${req.protocol}://${req.get("host")}/auth/callback`;
    
    // For preview environments without keys, we use a mock login flow
    // In production, you must set GOOGLE_CLIENT_ID in .env
    if (!GOOGLE_CLIENT_ID) {
      return res.json({ url: `/auth/mock-login` });
    }

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "email profile",
      access_type: "offline",
      prompt: "consent",
    });

    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  });

  app.get(["/auth/callback", "/auth/callback/"], async (req, res) => {
    const { code } = req.query;
    const redirectUri = `${req.protocol}://${req.get("host")}/auth/callback`;
    
    try {
      if (!GOOGLE_CLIENT_ID) throw new Error("Missing Google Client ID");
      
      // Exchange code for token
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: code as string,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      
      const tokenData = await tokenRes.json();
      if (!tokenData.id_token) throw new Error("Failed to get ID token");

      // Decode JWT to get email
      const decoded = jwt.decode(tokenData.id_token) as any;
      const email = decoded.email;

      // Initialize user
      if (!usersDb[email]) {
        const isSpecial = SPECIAL_EMAILS.includes(email);
        usersDb[email] = {
          email,
          credits: isSpecial ? Infinity : 20000,
          isPremium: isSpecial
        };
      }

      const sessionToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: "7d" });
      res.cookie("session", sessionToken, {
        secure: true,
        sameSite: "none",
        httpOnly: true,
      });

      res.send(`
        <html><body><script>
          if (window.opener) {
            window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', email: '${email}' }, '*');
            window.close();
          } else {
            window.location.href = '/';
          }
        </script></body></html>
      `);
    } catch (err) {
      res.status(500).send("Authentication failed. Please check your Google Client ID and Secret.");
    }
  });

  // Mock Login for Preview (when no OAuth keys are provided)
  app.get("/auth/mock-login", (req, res) => {
    res.send(`
      <html>
        <body style="background: #0a0a0a; color: white; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh;">
          <div style="background: #1a1a1a; padding: 2rem; border-radius: 12px; text-align: center; max-width: 400px; width: 100%;">
            <h2 style="margin-top: 0;">Preview Mode Login</h2>
            <p style="opacity: 0.7; margin-bottom: 1.5rem; font-size: 0.9rem;">Enter your email to simulate Google Login. <br/>(Use <b>amliyarsachin248@gmail.com</b> for unlimited credits)</p>
            <input type="email" id="email" placeholder="your@email.com" style="padding: 0.75rem; width: 100%; margin-bottom: 1rem; border-radius: 6px; border: 1px solid #333; background: #000; color: white; box-sizing: border-box;" />
            <button onclick="login()" style="background: #10b981; color: black; padding: 0.75rem 1rem; width: 100%; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 1rem;">Sign In</button>
            <script>
              function login() {
                const email = document.getElementById('email').value;
                if (!email) return;
                
                // Set mock session cookie
                document.cookie = "mock_session=" + encodeURIComponent(email) + "; path=/; max-age=86400; SameSite=None; Secure";
                
                if (window.opener) {
                  window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', email: email }, '*');
                  window.close();
                } else {
                  window.location.href = '/';
                }
              }
            </script>
          </div>
        </body>
      </html>
    `);
  });

  // Get User Profile
  app.get("/api/user", (req, res) => {
    // Check mock session first for preview mode
    const mockEmail = req.cookies.mock_session;
    if (mockEmail) {
      if (!usersDb[mockEmail]) {
        const isSpecial = SPECIAL_EMAILS.includes(mockEmail);
        usersDb[mockEmail] = {
          email: mockEmail,
          credits: isSpecial ? Infinity : 20000,
          isPremium: isSpecial
        };
      }
      return res.json(usersDb[mockEmail]);
    }

    const token = req.cookies.session;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const user = usersDb[decoded.email];
      if (!user) return res.status(404).json({ error: "User not found" });
      res.json(user);
    } catch (err) {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  // Logout Route
  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("session", { secure: true, sameSite: "none", httpOnly: true });
    res.clearCookie("mock_session", { secure: true, sameSite: "none", path: "/" });
    res.json({ success: true });
  });

  // Deduct Credits
  app.post("/api/user/deduct", (req, res) => {
    const mockEmail = req.cookies.mock_session;
    let email = mockEmail;

    if (!email) {
      const token = req.cookies.session;
      if (!token) return res.status(401).json({ error: "Unauthorized" });
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        email = decoded.email;
      } catch (err) {
        return res.status(401).json({ error: "Invalid token" });
      }
    }

    const user = usersDb[email];
    if (!user) return res.status(404).json({ error: "User not found" });
    
    const { amount } = req.body;
    if (user.credits !== Infinity) {
      if (user.credits < amount) return res.status(400).json({ error: "Insufficient credits" });
      user.credits -= amount;
    }
    res.json(user);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
