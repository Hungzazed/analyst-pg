import * as bcrypt from 'bcrypt';

async function runBenchmark() {
  const password = 'my_super_secret_refresh_token';
  const hashes: string[] = [];

  console.log('Generating 20 hashes...');
  for (let i = 0; i < 20; i++) {
    hashes.push(await bcrypt.hash(password + (i === 19 ? '' : 'wrong'), 10));
  }

  console.log('Starting sequential...');
  const startSeq = Date.now();
  for (const hash of hashes) {
    await bcrypt.compare(password, hash);
  }
  const endSeq = Date.now();
  console.log(`Sequential took: ${endSeq - startSeq}ms`);

  console.log('Starting concurrent...');
  const startConc = Date.now();
  await Promise.all(hashes.map(hash => bcrypt.compare(password, hash)));
  const endConc = Date.now();
  console.log(`Concurrent took: ${endConc - startConc}ms`);
}

runBenchmark().catch(console.error);
