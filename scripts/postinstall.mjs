// Only an explicit global installation enables the desktop CLI integration.
if (process.env.npm_config_global === 'true') {
  const { setup } = await import('../dist/src/setup.js');
  console.log(await setup());
}
