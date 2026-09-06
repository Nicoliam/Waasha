-- Slice 4: Payment foundation — provider-agnostic payments + webhook idempotency + cash change detail
-- Preserves existing payments, adds provider context, idempotency, gateway refs, timestamps, metadata

ALTER TABLE `payments` ADD COLUMN `provider_id` VARCHAR(191) NULL;
ALTER TABLE `payments` ADD COLUMN `business_unit_id` VARCHAR(191) NULL;
ALTER TABLE `payments` ADD COLUMN `idempotency_key` VARCHAR(191) NULL;
ALTER TABLE `payments` ADD COLUMN `gateway_transaction_id` VARCHAR(191) NULL;
ALTER TABLE `payments` ADD COLUMN `gateway_response_reference` VARCHAR(191) NULL;
ALTER TABLE `payments` ADD COLUMN `provider_reference` VARCHAR(191) NULL;
ALTER TABLE `payments` ADD COLUMN `internal_reference` VARCHAR(191) NULL;
ALTER TABLE `payments` ADD COLUMN `initiated_at` DATETIME(3) NULL;
ALTER TABLE `payments` ADD COLUMN `paid_at` DATETIME(3) NULL;
ALTER TABLE `payments` ADD COLUMN `failed_at` DATETIME(3) NULL;
ALTER TABLE `payments` ADD COLUMN `refunded_at` DATETIME(3) NULL;
ALTER TABLE `payments` ADD COLUMN `failure_reason` TEXT NULL;
ALTER TABLE `payments` ADD COLUMN `metadata` JSON NULL;

CREATE UNIQUE INDEX `payments_idempotency_key_key` ON `payments`(`idempotency_key`);
CREATE INDEX `payments_provider_id_idx` ON `payments`(`provider_id`);
CREATE INDEX `payments_customer_id_idx` ON `payments`(`customer_id`);
CREATE INDEX `payments_gateway_transaction_id_idx` ON `payments`(`gateway_transaction_id`);
CREATE INDEX `payments_idempotency_key_idx` ON `payments`(`idempotency_key`);

-- Payment webhook / gateway event audit — idempotent processing
CREATE TABLE `payment_events` (
    `id` VARCHAR(191) NOT NULL,
    `payment_id` VARCHAR(191) NOT NULL,
    `event_type` VARCHAR(191) NOT NULL,
    `gateway_event_id` VARCHAR(191) NULL,
    `payload_json` JSON NULL,
    `processing_status` VARCHAR(191) NOT NULL DEFAULT 'PROCESSED',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processed_at` DATETIME(3) NULL,
    UNIQUE INDEX `payment_events_gateway_event_id_key`(`gateway_event_id`),
    INDEX `payment_events_payment_id_idx`(`payment_id`),
    INDEX `payment_events_gateway_event_id_idx`(`gateway_event_id`),
    INDEX `payment_events_event_type_idx`(`event_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payment_events` ADD CONSTRAINT `payment_events_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Cash change detail — per booking, preserves changeRequested semantics without leaking to finance
CREATE TABLE `cash_payment_details` (
    `id` VARCHAR(191) NOT NULL,
    `booking_id` VARCHAR(191) NOT NULL,
    `change_requested` BOOLEAN NOT NULL DEFAULT false,
    `amount_tendered` DECIMAL(12, 2) NULL,
    `change_amount` DECIMAL(12, 2) NULL,
    `provider_notified_at` DATETIME(3) NULL,
    `confirmed_by_provider_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `cash_payment_details_booking_id_key`(`booking_id`),
    INDEX `cash_payment_details_booking_id_idx`(`booking_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `cash_payment_details` ADD CONSTRAINT `cash_payment_details_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
