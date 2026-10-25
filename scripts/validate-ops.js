/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..');
const alertsPath = path.join(root, 'ops/prometheus/alerts.yml');
const prometheusPath = path.join(root, 'ops/prometheus/prometheus.yml');
const dashboardPath = path.join(
  root,
  'ops/grafana/dashboards/gymsoins-overview.json',
);
const stagingPrometheusPath = path.join(
  root,
  'ops/prometheus/prometheus.staging.yml',
);
const stagingTestAlertsPath = path.join(
  root,
  'ops/prometheus/alerts.staging-test.yml',
);

function fail(message) {
  throw new Error(message);
}

const alerts = yaml.load(fs.readFileSync(alertsPath, 'utf8'));
const prometheus = yaml.load(fs.readFileSync(prometheusPath, 'utf8'));
const stagingPrometheus = yaml.load(
  fs.readFileSync(stagingPrometheusPath, 'utf8'),
);
const stagingTestAlerts = yaml.load(
  fs.readFileSync(stagingTestAlertsPath, 'utf8'),
);
const dashboard = JSON.parse(fs.readFileSync(dashboardPath, 'utf8'));

if (!Array.isArray(alerts.groups) || alerts.groups.length === 0) {
  fail('alerts.yml: groups absent');
}

let ruleCount = 0;

for (const group of alerts.groups) {
  if (!group.name || !Array.isArray(group.rules)) {
    fail(`alerts.yml: groupe invalide ${group.name || '<sans nom>'}`);
  }

  for (const rule of group.rules) {
    ruleCount += 1;
    if (!rule.alert) fail(`alerts.yml: alerte sans nom dans ${group.name}`);
    if (!rule.expr) fail(`alerts.yml: ${rule.alert} sans expr`);
    if (!rule.for) fail(`alerts.yml: ${rule.alert} sans for`);
    if (!rule.labels?.severity) {
      fail(`alerts.yml: ${rule.alert} sans severity`);
    }
    if (!['warning', 'critical'].includes(rule.labels.severity)) {
      fail(`alerts.yml: ${rule.alert} severity invalide`);
    }
    if (!rule.annotations?.action) {
      fail(`alerts.yml: ${rule.alert} sans action`);
    }
  }
}

if (!Array.isArray(prometheus.scrape_configs) || prometheus.scrape_configs.length === 0) {
  fail('prometheus.yml: scrape_configs absent');
}

if (!Array.isArray(dashboard.panels) || dashboard.panels.length === 0) {
  fail('dashboard: panels absent');
}

if (
  !Array.isArray(stagingPrometheus.scrape_configs) ||
  stagingPrometheus.scrape_configs.length === 0
) {
  fail('prometheus.staging.yml: scrape_configs absent');
}

const stagingRule = stagingTestAlerts.groups?.[0]?.rules?.[0];

if (stagingRule?.alert !== 'GymSoinsStagingAlertPipelineTest') {
  fail('alerts.staging-test.yml: règle de test absente');
}

for (const panel of dashboard.panels) {
  if (!panel.title || !panel.type || !Array.isArray(panel.targets)) {
    fail('dashboard: panneau invalide');
  }
  for (const target of panel.targets) {
    if (!target.expr) fail(`dashboard: panneau ${panel.title} sans expr`);
  }
}

console.log(
  JSON.stringify(
    {
      event: 'ops.validated',
      alertGroups: alerts.groups.length,
      alerts: ruleCount,
      scrapeJobs: prometheus.scrape_configs.length,
      stagingScrapeJobs: stagingPrometheus.scrape_configs.length,
      stagingTestAlert: stagingRule.alert,
      dashboardPanels: dashboard.panels.length,
      dashboardUid: dashboard.uid,
    },
    null,
    2,
  ),
);
