import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Roles
  for (const role of [
    { code: 'CUSTOMER', name: 'Customer' },
    { code: 'PROVIDER', name: 'Provider' },
    { code: 'TRAINING_CENTRE', name: 'Training Centre' },
    { code: 'ADMIN', name: 'Admin' },
  ]) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: {},
      create: role,
    });
  }

  // Provider tiers — T1/T2/T3 + STUDENT (verified student level, 16% commission, not ranking boost)
  for (const tier of [
    { code: 'STUDENT', name: 'Student', sortOrder: 0, description: 'Verified university/college student — requires verification, 16% commission, R500 cash cap' },
    { code: 'T1', name: 'Individual', sortOrder: 1 },
    { code: 'T2', name: 'Team', sortOrder: 2 },
    { code: 'T3', name: 'Business', sortOrder: 3 },
  ]) {
    await prisma.providerTier.upsert({
      where: { code: tier.code },
      update: {},
      create: tier,
    });
  }

  // Service categories — exactly 5 per blueprint
  for (const cat of [
    { code: 'BARBERS', name: 'Barbers', sortOrder: 1 },
    { code: 'HAIR_SALONS_STYLISTS', name: 'Hair Salons & Stylists', sortOrder: 2 },
    { code: 'NAIL_TECHNICIANS', name: 'Nail Technicians', sortOrder: 3 },
    { code: 'BEAUTY_SERVICES', name: 'Beauty Services', sortOrder: 4 },
    { code: 'CAR_WASH', name: 'Car Wash', sortOrder: 5 },
  ]) {
    await prisma.serviceCategory.upsert({
      where: { code: cat.code },
      update: {},
      create: cat,
    });
  }

  // Admin settings — radius vertical slice
  const settings: Array<{ settingKey: string; settingValue: string; valueType: string; description: string }> = [
    {
      settingKey: 'default_discovery_radius_km',
      settingValue: '10',
      valueType: 'NUMBER',
      description: 'Default customer discovery radius (km)',
    },
    {
      settingKey: 'max_discovery_radius_km',
      settingValue: '20',
      valueType: 'NUMBER',
      description: 'Absolute maximum customer discovery radius (km)',
    },
    {
      settingKey: 'allowed_customer_radii_km',
      settingValue: JSON.stringify([10, 15, 20]),
      valueType: 'JSON',
      description: 'Allowed customer discovery radii (km) — ordered expansion sequence',
    },
    {
      settingKey: 'allowed_provider_coverages_km',
      settingValue: JSON.stringify([10, 15, 20]),
      valueType: 'JSON',
      description: 'Allowed provider service coverage radii (km)',
    },
    {
      settingKey: 'max_provider_coverage_km',
      settingValue: '20',
      valueType: 'NUMBER',
      description: 'Absolute maximum provider coverage (km)',
    },
    {
      settingKey: 'default_platform_commission',
      settingValue: '25',
      valueType: 'NUMBER',
      description: 'Default platform commission % (configurable)',
    },
    {
      settingKey: 'max_service_images',
      settingValue: '3',
      valueType: 'NUMBER',
      description: 'Max images per service/style',
    },
    {
      settingKey: 'max_custom_request_images',
      settingValue: '3',
      valueType: 'NUMBER',
      description: 'Max images per custom request',
    },
    // Phase 1.5 — Tiered commission & cash liability caps (configurable, not hard-coded)
    {
      settingKey: 'commission_student_percent',
      settingValue: '16',
      valueType: 'NUMBER',
      description: 'Waasha commission % for verified Student providers (configurable)',
    },
    {
      settingKey: 'commission_t1_percent',
      settingValue: '25',
      valueType: 'NUMBER',
      description: 'Waasha commission % for T1 Individual (configurable)',
    },
    {
      settingKey: 'commission_t2_percent',
      settingValue: '25',
      valueType: 'NUMBER',
      description: 'Waasha commission % for T2 Teams (configurable)',
    },
    {
      settingKey: 'commission_t3_percent',
      settingValue: '25',
      valueType: 'NUMBER',
      description: 'Waasha commission % for T3 Business (configurable)',
    },
    {
      settingKey: 'cash_cap_student',
      settingValue: '500',
      valueType: 'NUMBER',
      description: 'Maximum outstanding Waasha commission owed from cash transactions — Student (ZAR)',
    },
    {
      settingKey: 'cash_cap_t1',
      settingValue: '1000',
      valueType: 'NUMBER',
      description: 'Maximum outstanding Waasha commission owed from cash transactions — T1 (ZAR)',
    },
    {
      settingKey: 'cash_cap_t2',
      settingValue: '1000',
      valueType: 'NUMBER',
      description: 'Maximum outstanding Waasha commission owed from cash transactions — T2 (ZAR)',
    },
    {
      settingKey: 'cash_cap_t3',
      settingValue: '5000',
      valueType: 'NUMBER',
      description: 'Maximum outstanding Waasha commission owed from cash transactions — T3 Business (ZAR)',
    },
    // Slice 17 — Training-centre partner share default (% of the platform
    // commission allocated to the attributed partner on eligible completed
    // services). Overridden by active partner_share_rules rows. Accruals
    // are ledger records, not payouts.
    {
      settingKey: 'partner_share_default_percent',
      settingValue: '10',
      valueType: 'NUMBER',
      description: 'Default % of platform commission allocated to the attributed training-centre partner (configurable)',
    },
    {
      settingKey: 'training_referral_ttl_days',
      settingValue: '30',
      valueType: 'NUMBER',
      description: 'Default training-centre referral invitation validity in days (configurable)',
    },
  ];

  for (const s of settings) {
    await prisma.adminSetting.upsert({
      where: { settingKey: s.settingKey },
      update: { settingValue: s.settingValue, valueType: s.valueType, description: s.description },
      create: s,
    });
  }

  console.log('Seed completed: roles, tiers, categories, admin_settings');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
