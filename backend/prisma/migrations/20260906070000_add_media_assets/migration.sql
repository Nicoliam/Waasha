-- Slice 11: Media & file storage foundation — provider-agnostic metadata.
-- Blueprint Document 12 (Media & File Storage Architecture).
-- MySQL stores metadata/relationships only — never raw binary bytes.
-- No vendor credentials, bucket names, or secrets stored here.
-- Existing Slice 9 (service_images) and Slice 10 (provider profile image
-- references) rows are preserved: new link columns are NULLABLE and the
-- media_assets table starts empty (no data backfill required).

CREATE TABLE `media_assets` (
    `id` VARCHAR(191) NOT NULL,
    `uuid` VARCHAR(191) NOT NULL,
    `owner_type` VARCHAR(191) NOT NULL,
    `owner_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NULL,
    `purpose` VARCHAR(191) NOT NULL,
    `target_id` VARCHAR(191) NULL,
    `storage_key` VARCHAR(191) NOT NULL,
    `original_filename` VARCHAR(191) NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `detected_mime_type` VARCHAR(191) NULL,
    `extension` VARCHAR(191) NULL,
    `size_bytes` INTEGER NOT NULL,
    `checksum` VARCHAR(191) NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `visibility` VARCHAR(191) NOT NULL DEFAULT 'PUBLIC',
    `moderation_status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_UPLOAD',
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    UNIQUE INDEX `media_assets_uuid_key`(`uuid`),
    UNIQUE INDEX `media_assets_storage_key_key`(`storage_key`),
    INDEX `media_assets_owner_type_owner_id_idx`(`owner_type`, `owner_id`),
    INDEX `media_assets_purpose_target_id_idx`(`purpose`, `target_id`),
    INDEX `media_assets_status_idx`(`status`),
    INDEX `media_assets_storage_key_idx`(`storage_key`),
    INDEX `media_assets_created_by_idx`(`created_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Optional link from a service image to its finalized media asset.
-- NULL preserves every pre-existing Slice 9 image reference.
ALTER TABLE `service_images`
    ADD COLUMN `media_asset_id` VARCHAR(191) NULL,
    ADD INDEX `service_images_media_asset_id_idx`(`media_asset_id`);

-- Optional link from a provider profile to its finalized profile media.
-- NULL preserves every pre-existing Slice 10 profile image reference.
ALTER TABLE `provider_profiles`
    ADD COLUMN `profile_media_asset_id` VARCHAR(191) NULL;
