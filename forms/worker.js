const path = require('node:path');
const { pathToFileURL } = require('node:url');

const formsApp = require('./server');

async function main() {
  const adapterPath = String(process.env.FORMS_WORKER_ADAPTER || '').trim();
  if (!adapterPath) {
    throw new Error(
      'FORMS_WORKER_ADAPTER is required (module exporting jobRepository and usageManager)'
    );
  }

  const absoluteAdapterPath = path.isAbsolute(adapterPath)
    ? adapterPath
    : path.resolve(process.cwd(), adapterPath);
  const adapterModule = await import(pathToFileURL(absoluteAdapterPath).href);
  const adapter = typeof adapterModule.createFormsWorkerAdapter === 'function'
    ? await adapterModule.createFormsWorkerAdapter()
    : adapterModule;

  if (!adapter?.jobRepository || !adapter?.usageManager) {
    throw new Error('Forms worker adapter must expose jobRepository and usageManager');
  }

  formsApp.setUsageManager(adapter.usageManager);
  if (adapter.metricsObserver && typeof formsApp.setMetricsObserver === 'function') {
    formsApp.setMetricsObserver(adapter.metricsObserver);
  }
  if (adapter.keyValidator) {
    formsApp.setKeyValidator(adapter.keyValidator);
  }
  await formsApp.setJobRepository(adapter.jobRepository);

  const shutdown = async () => {
    try {
      await adapter.close?.();
      process.exit(0);
    } catch (error) {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exit(1);
    }
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.stdout.write('TesisHub Forms worker ready\n');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
