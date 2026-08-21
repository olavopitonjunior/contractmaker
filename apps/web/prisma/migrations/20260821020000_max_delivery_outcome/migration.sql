-- Desfecho de entrega reportado pelo Max (POST /api/webhooks/max).
-- Coluna própria: os settles dos trilhos substituem `detail` inteiro a cada
-- tentativa e apagariam a marca se ela morasse lá.
ALTER TABLE "DealNotificationLog" ADD COLUMN "maxDeliveryJson" JSONB;
ALTER TABLE "UserNotificationDelivery" ADD COLUMN "maxDeliveryJson" JSONB;
