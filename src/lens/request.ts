import { F } from '../gen/fields.js';
import { writer } from '../protobuf.js';
import type { Bytes, PreparedImage, Settings } from '../types.js';

/** Enum values from Chromium's platform/surface/filter protos. */
const PLATFORM_WEB = 3;
const SURFACE_CHROMIUM = 4;
const FILTER_TRANSLATE = 2;
const FILTER_AUTO = 7;
const RENDERING_ENV_LENS_OVERLAY = 14;

/** A 62-bit random session id; Chromium mints one per overlay session. */
function randomUuid(): bigint {
  const high = BigInt(Math.floor(Math.random() * 0x4000_0000));
  const low = BigInt(Math.floor(Math.random() * 0x1_0000_0000));
  return (high << 32n) | low;
}

/**
 * Build the objects request.
 *
 * Chromium always sends exactly one client filter, and TRANSLATE *replaces*
 * AUTO_FILTER rather than joining it, so sending both is a state real Chrome
 * never produces.
 */
export function buildRequest(image: PreparedImage, settings: Settings): Bytes {
  const translating = Boolean(settings.targetLang);

  return writer()
    .sub(F.LensOverlayServerRequest.objectsRequest, (objects) => {
      objects.sub(F.LensOverlayObjectsRequest.requestContext, (ctx) => {
        ctx.sub(F.LensOverlayRequestContext.requestId, (id) =>
          id
            .int(F.LensOverlayRequestId.uuid, randomUuid())
            .int(F.LensOverlayRequestId.sequenceId, 1)
            .int(F.LensOverlayRequestId.imageSequenceId, 1)
        );
        ctx.sub(F.LensOverlayRequestContext.clientContext, (client) => {
          client.int(F.LensOverlayClientContext.platform, PLATFORM_WEB);
          client.int(F.LensOverlayClientContext.surface, SURFACE_CHROMIUM);
          client.sub(F.LensOverlayClientContext.localeContext, (locale) =>
            locale
              .str(F.LocaleContext.language, settings.ocrLang || settings.targetLang)
              .str(F.LocaleContext.region, settings.region)
              .str(F.LocaleContext.timeZone, settings.timeZone)
          );
          client.sub(F.LensOverlayClientContext.clientFilters, (filters) =>
            filters.sub(F.AppliedFilters.filter, (filter) => {
              if (!translating) {
                filter.int(F.AppliedFilter.filterType, FILTER_AUTO);
                return;
              }
              filter.int(F.AppliedFilter.filterType, FILTER_TRANSLATE);
              filter.sub(F.AppliedFilter.translate, (translate) =>
                translate
                  .str(F.AppliedFilter_Translate.targetLanguage, settings.targetLang)
                  .str(F.AppliedFilter_Translate.sourceLanguage, settings.sourceLang)
              );
            })
          );
          client.sub(F.LensOverlayClientContext.renderingContext, (rendering) =>
            rendering.int(F.RenderingContext.renderingEnvironment, RENDERING_ENV_LENS_OVERLAY)
          );
        });
      });
      objects.sub(F.LensOverlayObjectsRequest.imageData, (data) => {
        data.sub(F.ImageData.payload, (payload) =>
          payload.bytes(F.ImagePayload.imageBytes, image.imageBytes)
        );
        data.sub(F.ImageData.imageMetadata, (meta) =>
          meta.int(F.ImageMetadata.width, image.width).int(F.ImageMetadata.height, image.height)
        );
      });
    })
    .finish();
}
