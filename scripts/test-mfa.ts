// scripts/test-mfa.ts — MFA setup/verify + login with totp (DB direct, no HTTP)
import { PrismaClient } from '@prisma/client';
import { generateSecret, totp, verify } from '../src/lib/auth/totp';
import { hashPasswordSync } from '../src/lib/auth/password';

const db = new PrismaClient();

async function main() {
  console.log('=== MFA TESTS ===');
  let pass = 0, fail = 0;
  const ok = (m: string) => { console.log(`PASS: ${m}`); pass++; };
  const bad = (m: string) => { console.log(`FAIL: ${m}`); fail++; };

  // 1. Generate secret and verify
  const secret = generateSecret();
  if (secret.length === 32) ok('generateSecret 32 chars');
  else bad('generateSecret');

  const token = totp(secret);
  if (verify(token, secret)) ok('verify totp true');
  else bad('verify totp');

  if (!verify('000000', secret)) ok('verify false for 000000');
  else bad('verify false');

  // 2. Setup MFA for a test user (create temp user)
  const testEmail = `mfa-test-${Date.now()}@local`;
  const hash = hashPasswordSync('Test123!');
  const user = await db.user.create({ data: { email: testEmail, passwordHash: hash, role: 'viewer' } });
  ok(`created temp user ${testEmail}`);

  // Simulate POST /api/auth/mfa/setup -> update mfaSecret
  const testSecret = generateSecret();
  await db.user.update({ where: { id: user.id }, data: { mfaSecret: testSecret, mfaEnabled: false } });
  const afterSetup = await db.user.findUnique({ where: { id: user.id } });
  if (afterSetup?.mfaSecret === testSecret && !afterSetup.mfaEnabled) ok('mfa setup secret saved, not enabled');
  else bad('mfa setup');

  // Verify -> enable
  const goodTotp = totp(testSecret);
  if (verify(goodTotp, testSecret)) {
    await db.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    const afterVerify = await db.user.findUnique({ where: { id: user.id } });
    if (afterVerify?.mfaEnabled) ok('mfa verify enabled');
    else bad('mfa verify');
  } else bad('totp generation');

  // 3. Login flow simulation: user with mfaEnabled must provide totp
  // Simulate login logic from src/app/api/auth/login/route.ts
  const loginUser = await db.user.findUnique({ where: { email: testEmail } });
  if (loginUser?.mfaEnabled) {
    // without totp -> should be mfaRequired
    const withoutTotp = !verify('', loginUser.mfaSecret!);
    if (withoutTotp) ok('mfaEnabled without totp would be rejected (simulated)');
    else bad('mfaRequired simulation');

    // with correct totp -> should pass
    const correct = totp(loginUser.mfaSecret!);
    if (verify(correct, loginUser.mfaSecret!)) ok('mfa login with correct totp passes');
    else bad('mfa login');

    // with wrong totp -> fail
    if (!verify('000000', loginUser.mfaSecret!)) ok('mfa login with wrong totp fails');
    else bad('wrong totp should fail');
  } else bad('user mfaEnabled true');

  // Cleanup
  await db.user.delete({ where: { id: user.id } });
  ok('cleanup temp user');

  // Disable MFA for admin (ensure admin is clean)
  await db.user.updateMany({ where: { email: 'admin@local' }, data: { mfaEnabled: false, mfaSecret: null } });
  ok('reset admin mfa disabled for dev');

  console.log(`\n=== RESULT: ${pass} PASS, ${fail} FAIL ===`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
