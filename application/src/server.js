const express = require("express");
const client = require("prom-client");
const pino = require("pino");
const pinoHttp = require("pino-http");

const app = express();

const PORT = process.env.PORT || 3000;
const APP_NAME = process.env.APP_NAME || "incident-demo";
const APP_VERSION = process.env.APP_VERSION || "local-dev";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: {
    service: APP_NAME,
    version: APP_VERSION
  }
});

app.use(express.json());

app.use(
  pinoHttp({
    logger,
    customProps: function (req, res) {
      return {
        service: APP_NAME,
        version: APP_VERSION
      };
    }
  })
);

// =======================
// Prometheus metrics setup
// =======================

client.collectDefaultMetrics({
  prefix: "incident_demo_"
});

const httpRequestDurationSeconds = new client.Histogram({
  name: "incident_demo_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5]
});

const httpRequestsTotal = new client.Counter({
  name: "incident_demo_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"]
});

const httpErrorsTotal = new client.Counter({
  name: "incident_demo_http_errors_total",
  help: "Total number of HTTP error responses",
  labelNames: ["method", "route", "status_code"]
});

app.use((req, res, next) => {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const end = process.hrtime.bigint();
    const durationSeconds = Number(end - start) / 1e9;

    const route = req.route && req.route.path ? req.route.path : req.path;
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode)
    };

    httpRequestDurationSeconds.observe(labels, durationSeconds);
    httpRequestsTotal.inc(labels);

    if (res.statusCode >= 500) {
      httpErrorsTotal.inc(labels);
    }
  });

  next();
});

// =======================
// Routes
// =======================

app.get("/", (req, res) => {
  res.json({
    app: APP_NAME,
    version: APP_VERSION,
    message: "Kubernetes AI Incident Response Demo App",
    endpoints: [
      "/health",
      "/metrics",
      "/api/products",
      "/api/error",
      "/api/slow"
    ]
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    app: APP_NAME,
    version: APP_VERSION,
    uptime: process.uptime()
  });
});

app.get("/api/products", (req, res) => {
  res.json({
    data: [
      { id: 1, name: "Laptop", price: 1200 },
      { id: 2, name: "Keyboard", price: 80 },
      { id: 3, name: "Mouse", price: 40 }
    ]
  });
});

app.get("/api/error", (req, res) => {
  req.log.error(
    {
      event: "intentional_error",
      path: "/api/error",
      status: 500
    },
    "Intentional HTTP 500 error for monitoring demo"
  );

  res.status(500).json({
    error: "Intentional error",
    message: "This endpoint is used to trigger monitoring alerts"
  });
});

app.get("/api/slow", async (req, res) => {
  const delayMs = Number(req.query.delay || 2000);

  await new Promise((resolve) => setTimeout(resolve, delayMs));

  res.json({
    message: "Slow response completed",
    delayMs
  });
});

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

// =======================
// Error handler
// =======================

app.use((err, req, res, next) => {
  req.log.error(
    {
      err,
      path: req.path
    },
    "Unhandled application error"
  );

  res.status(500).json({
    error: "Internal Server Error"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  logger.info(
    {
      port: PORT,
      app: APP_NAME,
      version: APP_VERSION
    },
    "Application started"
  );
});
