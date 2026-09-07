-- Slice 14: POS & inventory foundation — provider operational tooling.
-- Blueprint: AGENTS.md Slice 14 (no blueprint POS section exists; POS
-- commission treatment is therefore an explicit extension point, deferred
-- to the finance/admin slice — see pos_sales commission columns below).
-- A POS sale is NOT a booking: no booking, payment, or cash-ledger rows
-- are created here. Inventory quantities are server-authoritative; every
-- change is traced through inventory_movements with resulting balances.

CREATE TABLE `inventory_items` (
    `id` VARCHAR(191) NOT NULL,
    `uuid` VARCHAR(191) NOT NULL,
    `provider_id` VARCHAR(191) NOT NULL,
    `business_unit_id` VARCHAR(191) NULL,
    `sku` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `unit` VARCHAR(191) NOT NULL DEFAULT 'unit',
    `cost_price` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `selling_price` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'ZAR',
    `quantity_on_hand` INTEGER NOT NULL DEFAULT 0,
    `low_stock_threshold` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `image_url` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    UNIQUE INDEX `inventory_items_uuid_key`(`uuid`),
    INDEX `inventory_items_provider_id_idx`(`provider_id`),
    INDEX `inventory_items_business_unit_id_idx`(`business_unit_id`),
    INDEX `inventory_items_provider_id_is_active_idx`(`provider_id`, `is_active`),
    INDEX `inventory_items_provider_id_sku_idx`(`provider_id`, `sku`),
    INDEX `inventory_items_is_active_idx`(`is_active`),
    INDEX `inventory_items_updated_at_idx`(`updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `inventory_movements` (
    `id` VARCHAR(191) NOT NULL,
    `item_id` VARCHAR(191) NOT NULL,
    `provider_id` VARCHAR(191) NOT NULL,
    `business_unit_id` VARCHAR(191) NULL,
    `movement_type` VARCHAR(191) NOT NULL,
    `quantity_delta` INTEGER NOT NULL,
    `resulting_quantity` INTEGER NOT NULL,
    `actor_user_id` VARCHAR(191) NOT NULL,
    `reference_type` VARCHAR(191) NULL,
    `reference_id` VARCHAR(191) NULL,
    `reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `inventory_movements_item_id_created_at_idx`(`item_id`, `created_at`),
    INDEX `inventory_movements_provider_id_created_at_idx`(`provider_id`, `created_at`),
    INDEX `inventory_movements_movement_type_idx`(`movement_type`),
    INDEX `inventory_movements_reference_type_reference_id_idx`(`reference_type`, `reference_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `inventory_movements_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `pos_sales` (
    `id` VARCHAR(191) NOT NULL,
    `uuid` VARCHAR(191) NOT NULL,
    `provider_id` VARCHAR(191) NOT NULL,
    `business_unit_id` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'COMPLETED',
    `payment_method` VARCHAR(191) NOT NULL,
    `payment_status` VARCHAR(191) NOT NULL DEFAULT 'PAID',
    `currency` VARCHAR(191) NOT NULL DEFAULT 'ZAR',
    `subtotal` DECIMAL(12, 2) NOT NULL,
    `total_amount` DECIMAL(12, 2) NOT NULL,
    `commission_rate` DECIMAL(5, 2) NULL,
    `commission_amount` DECIMAL(12, 2) NULL,
    `commission_eligible` BOOLEAN NOT NULL DEFAULT false,
    `idempotency_key` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `reversed_at` DATETIME(3) NULL,
    `reversal_reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `pos_sales_uuid_key`(`uuid`),
    UNIQUE INDEX `pos_sales_idempotency_key_key`(`idempotency_key`),
    INDEX `pos_sales_provider_id_created_at_idx`(`provider_id`, `created_at`),
    INDEX `pos_sales_business_unit_id_created_at_idx`(`business_unit_id`, `created_at`),
    INDEX `pos_sales_status_idx`(`status`),
    INDEX `pos_sales_payment_method_idx`(`payment_method`),
    INDEX `pos_sales_idempotency_key_idx`(`idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `pos_sale_lines` (
    `id` VARCHAR(191) NOT NULL,
    `sale_id` VARCHAR(191) NOT NULL,
    `line_type` VARCHAR(191) NOT NULL,
    `service_id` VARCHAR(191) NULL,
    `inventory_item_id` VARCHAR(191) NULL,
    `name_snapshot` VARCHAR(191) NOT NULL,
    `unit_price` DECIMAL(12, 2) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `line_total` DECIMAL(12, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `pos_sale_lines_sale_id_idx`(`sale_id`),
    INDEX `pos_sale_lines_service_id_idx`(`service_id`),
    INDEX `pos_sale_lines_inventory_item_id_idx`(`inventory_item_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `pos_sale_lines_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `pos_sales`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `pos_sale_lines_inventory_item_id_fkey` FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
