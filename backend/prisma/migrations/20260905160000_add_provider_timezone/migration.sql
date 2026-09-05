-- Add timezone to provider_profiles for provider-local availability handling
ALTER TABLE `provider_profiles` ADD COLUMN `timezone` VARCHAR(191) NOT NULL DEFAULT 'Africa/Johannesburg';
