require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api', limiter);

// Body parsing - no size limit for large file uploads
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Health check endpoint (useful for Railway)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Landing page - promotional website
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nuestra App - Organiza tu hogar</title>
  <meta name="description" content="La app para parejas y familias que quieren organizar su vida juntos. Tableros, recetas, menús, gastos compartidos y más.">
  <meta property="og:title" content="Nuestra App - Organiza tu hogar">
  <meta property="og:description" content="La app para parejas y familias que quieren organizar su vida juntos.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://nuestra-app.benja.ar">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏠</text></svg>">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --primary: #667eea;
      --primary-dark: #764ba2;
      --text: #333;
      --text-light: #666;
      --bg: #f8f9fa;
      --white: #fff;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      color: var(--text);
      line-height: 1.6;
    }

    /* Hero Section */
    .hero {
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      color: var(--white);
      padding: 80px 20px;
      text-align: center;
      min-height: 80vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .hero-logo { font-size: 80px; margin-bottom: 20px; }
    .hero h1 { font-size: 2.5rem; margin-bottom: 16px; font-weight: 700; }
    .hero p { font-size: 1.25rem; opacity: 0.9; max-width: 600px; margin: 0 auto 32px; }

    /* Download Buttons */
    .download-buttons {
      display: flex;
      gap: 16px;
      justify-content: center;
      flex-wrap: wrap;
      margin-bottom: 40px;
    }
    .download-btn {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      background: var(--white);
      color: var(--text);
      padding: 14px 28px;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 600;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .download-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }
    .download-btn svg { width: 24px; height: 24px; }
    .download-btn span { font-size: 12px; opacity: 0.7; display: block; }
    .download-btn strong { font-size: 16px; }

    /* Features Section */
    .features {
      padding: 80px 20px;
      background: var(--bg);
    }
    .features h2 {
      text-align: center;
      font-size: 2rem;
      margin-bottom: 48px;
    }
    .features-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 32px;
      max-width: 1200px;
      margin: 0 auto;
    }
    .feature-card {
      background: var(--white);
      padding: 32px;
      border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
    }
    .feature-icon { font-size: 40px; margin-bottom: 16px; }
    .feature-card h3 { font-size: 1.25rem; margin-bottom: 8px; }
    .feature-card p { color: var(--text-light); }

    /* How It Works */
    .how-it-works {
      padding: 80px 20px;
      text-align: center;
    }
    .how-it-works h2 {
      font-size: 2rem;
      margin-bottom: 48px;
    }
    .steps {
      display: flex;
      justify-content: center;
      gap: 40px;
      flex-wrap: wrap;
      max-width: 900px;
      margin: 0 auto;
    }
    .step {
      flex: 1;
      min-width: 200px;
      max-width: 250px;
    }
    .step-number {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      color: var(--white);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 1.25rem;
      margin: 0 auto 16px;
    }
    .step h3 { margin-bottom: 8px; }
    .step p { color: var(--text-light); font-size: 0.95rem; }

    /* CTA Section */
    .cta {
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      color: var(--white);
      padding: 60px 20px;
      text-align: center;
    }
    .cta h2 { font-size: 1.75rem; margin-bottom: 24px; }
    .cta .download-buttons { margin-bottom: 0; }

    /* Footer */
    footer {
      background: var(--text);
      color: var(--white);
      padding: 40px 20px;
      text-align: center;
    }
    footer p { opacity: 0.7; font-size: 0.9rem; }
    footer a { color: var(--white); }

    @media (max-width: 600px) {
      .hero h1 { font-size: 1.75rem; }
      .hero p { font-size: 1rem; }
      .hero-logo { font-size: 60px; }
    }
  </style>
</head>
<body>
  <!-- Hero -->
  <section class="hero">
    <div class="hero-logo">🏠</div>
    <h1>Nuestra App</h1>
    <p>La app para parejas y familias que quieren organizar su vida diaria juntos. Tableros compartidos, recetas, menús semanales, gastos divididos y más.</p>
    <div class="download-buttons">
      <a href="#" class="download-btn" onclick="alert('Próximamente en App Store'); return false;">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
        <div><span>Descargar en</span><strong>App Store</strong></div>
      </a>
      <a href="#" class="download-btn" onclick="alert('Próximamente en Google Play'); return false;">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.6 3,21.09 3,20.5M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.53,12.9 20.18,13.18L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81M6.05,2.66L16.81,8.88L14.54,11.15L6.05,2.66Z"/></svg>
        <div><span>Descargar en</span><strong>Google Play</strong></div>
      </a>
    </div>
  </section>

  <!-- Features -->
  <section class="features">
    <h2>Todo lo que necesitas para tu hogar</h2>
    <div class="features-grid">
      <div class="feature-card">
        <div class="feature-icon">📌</div>
        <h3>Tableros compartidos</h3>
        <p>Guarda links, fotos e inspiración. Como Pinterest pero privado para tu hogar.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🍳</div>
        <h3>Recetario familiar</h3>
        <p>Guarda tus recetas favoritas. Escanea fotos de recetas y la IA las transcribe.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">📅</div>
        <h3>Menú semanal</h3>
        <p>Planifica las comidas de la semana. Genera listas de compras automáticas.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">💰</div>
        <h3>Gastos compartidos</h3>
        <p>División proporcional por ingresos. Escanea tickets con IA. Balance mensual.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🎁</div>
        <h3>Listas de deseos</h3>
        <p>Compras pendientes, ideas de regalos y lista del super. Todo sincronizado.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">📆</div>
        <h3>Calendario compartido</h3>
        <p>Eventos, cumpleaños y recordatorios. Nunca olvides una fecha importante.</p>
      </div>
    </div>
  </section>

  <!-- How It Works -->
  <section class="how-it-works">
    <h2>Empieza en minutos</h2>
    <div class="steps">
      <div class="step">
        <div class="step-number">1</div>
        <h3>Descarga la app</h3>
        <p>Disponible para iOS y Android. Inicia sesión con Google o Apple.</p>
      </div>
      <div class="step">
        <div class="step-number">2</div>
        <h3>Crea tu hogar</h3>
        <p>Dale un nombre a tu hogar y configura las preferencias básicas.</p>
      </div>
      <div class="step">
        <div class="step-number">3</div>
        <h3>Invita gente</h3>
        <p>Comparte un código de invitación y empiecen a organizarse juntos.</p>
      </div>
    </div>
  </section>

  <!-- CTA -->
  <section class="cta">
    <h2>¿Listos para organizar su hogar?</h2>
    <div class="download-buttons">
      <a href="#" class="download-btn" onclick="alert('Próximamente en App Store'); return false;">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
        <div><span>Descargar en</span><strong>App Store</strong></div>
      </a>
      <a href="#" class="download-btn" onclick="alert('Próximamente en Google Play'); return false;">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.6 3,21.09 3,20.5M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.53,12.9 20.18,13.18L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81M6.05,2.66L16.81,8.88L14.54,11.15L6.05,2.66Z"/></svg>
        <div><span>Descargar en</span><strong>Google Play</strong></div>
      </a>
    </div>
  </section>

  <!-- Footer -->
  <footer>
    <p>© ${new Date().getFullYear()} Nuestra App. Hecho con ❤️ para hogares felices.</p>
  </footer>
</body>
</html>
  `);
});

// Universal Links - Android App Links verification
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.householdhub.nuestra_app',
      sha256_cert_fingerprints: [
        process.env.ANDROID_SHA256_FINGERPRINT || 'SHA256_FINGERPRINT_PLACEHOLDER'
      ]
    }
  }]);
});

// Universal Links - iOS App Site Association
app.get('/.well-known/apple-app-site-association', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json({
    applinks: {
      apps: [],
      details: [{
        appID: `${process.env.APPLE_TEAM_ID || 'TEAM_ID'}.com.householdhub.nuestra_app`,
        paths: ['/join/*']
      }]
    }
  });
});

// Web landing page for invite links
app.get('/join/:code', (req, res) => {
  const { code } = req.params;
  const appScheme = 'householdhub';
  const webAppUrl = `https://nuestra-app-web.benja.ar/join/${code}`;

  res.setHeader('Content-Type', 'text/html');
  res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unirse a Nuestra App</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 40px;
      max-width: 400px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .logo { font-size: 48px; margin-bottom: 16px; }
    h1 { color: #333; margin-bottom: 8px; font-size: 24px; }
    p { color: #666; margin-bottom: 24px; }
    .code {
      background: #f5f5f5;
      border: 2px dashed #ddd;
      border-radius: 8px;
      padding: 16px;
      font-family: monospace;
      font-size: 24px;
      font-weight: bold;
      letter-spacing: 2px;
      color: #333;
      margin-bottom: 24px;
    }
    .btn {
      display: block;
      width: 100%;
      padding: 16px;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      margin-bottom: 12px;
    }
    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .btn-web {
      background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
      color: white;
    }
    .btn-secondary {
      background: #f5f5f5;
      color: #333;
    }
    .divider {
      display: flex;
      align-items: center;
      margin: 20px 0;
      color: #999;
      font-size: 14px;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #ddd;
    }
    .divider span { padding: 0 12px; }
    .hint { color: #999; font-size: 14px; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🏠</div>
    <h1>Te invitaron a un hogar</h1>
    <p>Usa este código para unirte</p>
    <div class="code">${code}</div>
    <a href="${appScheme}://join/${code}" class="btn btn-primary" id="openApp">
      Abrir en la app
    </a>
    <div class="divider"><span>o</span></div>
    <a href="${webAppUrl}" class="btn btn-web">
      Unirse desde el navegador
    </a>
    <button class="btn btn-secondary" onclick="copyCode()">
      Copiar código
    </button>
    <p class="hint">¿No tienes la app? Únete desde el navegador o descárgala</p>
  </div>
  <script>
    function copyCode() {
      navigator.clipboard.writeText('${code}');
      alert('Código copiado: ${code}');
    }
    // Try to open the app automatically on mobile
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      setTimeout(() => {
        window.location.href = '${appScheme}://join/${code}';
      }, 100);
    }
  </script>
</body>
</html>
  `);
});

// API info
app.get('/api', (req, res) => {
  res.json({
    name: 'Household Hub API',
    version: '1.0.0',
    modules: ['boards', 'recipes', 'menus', 'expenses', 'wishlist', 'calendar', 'tasks', 'activity', 'preferences', 'chat']
  });
});

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/api/households', require('./routes/households'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/boards', require('./routes/boards'));
app.use('/api/recipes', require('./routes/recipes'));
app.use('/api/menus', require('./routes/menus'));
app.use('/api/wishlists', require('./routes/wishlists'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/users/preferences', require('./routes/preferences'));
app.use('/api/chat', require('./routes/chat'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
