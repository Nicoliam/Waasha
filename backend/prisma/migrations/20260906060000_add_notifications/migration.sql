-- Slice 7: Notifications & booking communication — provider-agnostic, IN_APP primary
-- Blueprint §39 (notifications) + §40 (notification_preferences).
-- Domain emits intents; delivery adapters plug in later. No vendor SDK, no secrets,
-- no precise location data stored. event_key UNIQUE enforces idempotent emission.

CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `audience` VARCHAR(191) NOT NULL DEFAULT 'CUSTOMER',
    `type` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL DEFAULT 'IN_APP',
    `status` VARCHAR(191) NOT NULL DEFAULT 'UNREAD',
    `title` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `entity_type` VARCHAR(191) NULL,
    `entity_id` VARCHAR(191) NULL,
    `event_key` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `notifications_event_key_key`(`event_key`),
    INDEX `notifications_user_id_status_created_at_idx`(`user_id`, `status`, `created_at`),
    INDEX `notifications_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `notifications_event_key_idx`(`event_key`),
    INDEX `notifications_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notification_preferences` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL DEFAULT 'IN_APP',
    `notification_type` VARCHAR(191) NOT NULL,
    `is_enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `notification_preferences_user_id_channel_notification_type_key`(`user_id`, `channel`, `notification_type`),
    INDEX `notification_preferences_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
