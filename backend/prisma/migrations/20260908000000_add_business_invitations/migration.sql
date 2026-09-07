-- Slice 15: T2/T3 business-management invitations — secure, scoped, expiring, single-use.
-- Only the SHA-256 hash of the random token is persisted; the raw token is
-- returned once at creation and never logged. No historical data is touched:
-- deactivating members/staff/units never deletes bookings, services or POS rows.

CREATE TABLE `team_invitations` (
    `id` VARCHAR(191) NOT NULL,
    `team_id` VARCHAR(191) NOT NULL,
    `invited_provider_id` VARCHAR(191) NULL,
    `invited_email` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'PROVIDER',
    `token_hash` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `expires_at` DATETIME(3) NOT NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `accepted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `team_invitations_token_hash_key`(`token_hash`),
    INDEX `team_invitations_team_id_status_idx`(`team_id`, `status`),
    INDEX `team_invitations_invited_provider_id_idx`(`invited_provider_id`),
    INDEX `team_invitations_status_expires_at_idx`(`status`, `expires_at`),
    PRIMARY KEY (`id`),
    CONSTRAINT `team_invitations_team_id_fkey` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `business_staff_invitations` (
    `id` VARCHAR(191) NOT NULL,
    `business_id` VARCHAR(191) NOT NULL,
    `business_unit_id` VARCHAR(191) NULL,
    `invited_provider_id` VARCHAR(191) NULL,
    `invited_email` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'STAFF',
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `token_hash` VARCHAR(191) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `accepted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `business_staff_invitations_token_hash_key`(`token_hash`),
    INDEX `business_staff_invitations_business_id_status_idx`(`business_id`, `status`),
    INDEX `business_staff_invitations_business_unit_id_idx`(`business_unit_id`),
    INDEX `business_staff_invitations_invited_provider_id_idx`(`invited_provider_id`),
    INDEX `business_staff_invitations_status_expires_at_idx`(`status`, `expires_at`),
    PRIMARY KEY (`id`),
    CONSTRAINT `business_staff_invitations_business_id_fkey` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `business_staff_invitations_business_unit_id_fkey` FOREIGN KEY (`business_unit_id`) REFERENCES `business_units`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
