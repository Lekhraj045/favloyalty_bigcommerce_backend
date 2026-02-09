const systemRoutes = require("./systemRoutes");
const apiRoutes = require("./apiRoutes");
const authRoutes = require("./authRoutes");
const loadRoutes = require("./loadRoutes");
const uninstallRoutes = require("./uninstallRoutes");
const debugRoutes = require("./debugRoutes");
const webhookRoutes = require("./webhookRoutes");

module.exports = (app) => {
  app.use("/", systemRoutes);
  app.use("/api", apiRoutes);
  app.use("/auth", authRoutes);
  app.use("/load", loadRoutes);
  app.use("/uninstall", uninstallRoutes);
  app.use("/debug", debugRoutes);
  app.use("/api/webhooks", webhookRoutes);
};
