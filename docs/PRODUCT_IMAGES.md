# Safe product images

Product media is presentation data, not the sole proof of authenticity. Every
signed product version includes the SHA-256 hash of its final stored image, but
wallet signatures, lifecycle hashes, and payment evidence remain authoritative.

## Processing and validation

The mobile client accepts JPEG, PNG, WebP, HEIC, and HEIF camera images up to
10 MB. SVG, GIF, HTML, empty files, and unsupported formats are rejected. The
browser must successfully decode the pixels, validates source dimensions and a
40-megapixel limit, scales the longest edge to at most 1,600 pixels, and
rasterizes the result to WebP. This strips active content, animation, and source
metadata before upload.

The Worker accepts only the resulting safe WebP or JPEG output, with a 1.5 MB
limit. It independently validates the container structure, decoded dimensions,
and length, then hashes the exact bytes. The object is stored with immutable
cache metadata at:

```text
products/<hashed-wallet-prefix>/<random-unguessable-path>/<content-hash>.<webp|jpg>
```

Before issuing a signing challenge, the API checks that this exact object
exists under the authenticated wallet path and that its R2 `contentHash`
metadata matches the hash that will enter the signed product payload.

## Mobile recovery states

The merchant form provides a camera-oriented file picker, preview, remove
action, decode/resize state, byte-upload progress, retry after failure, and
cleanup of abandoned uploads. Once a real image has been selected, production
never silently replaces it with the repository demo image. If the R2 binding is
missing or a write fails, `/api/product-images` returns a recoverable
`image_storage_unavailable` error with HTTP 503 and the merchant can retry the
same draft after storage recovers.

The fixed `demo-product.svg` and its signed hash remain supported only for
legacy/demo references that already use the explicit demo image key; it is not
used as an automatic fallback for a failed real-image upload.

## Cloudflare R2 deployment setup

The judging-readiness configuration binds `PRODUCT_IMAGES` to
`nimtrace-images` in production and uses `nimtrace-images-preview` for remote
development/preview storage. Both buckets must exist in the Cloudflare account
before deploying the Worker configuration that contains the binding.

Create the buckets with:

```powershell
node --use-system-ca node_modules\wrangler\bin\wrangler.js r2 bucket create nimtrace-images-preview
node --use-system-ca node_modules\wrangler\bin\wrangler.js r2 bucket create nimtrace-images
```

The matching Worker configuration is:

```jsonc
"r2_buckets": [
  {
    "binding": "PRODUCT_IMAGES",
    "bucket_name": "nimtrace-images",
    "preview_bucket_name": "nimtrace-images-preview"
  }
]
```

After deployment, verify that `POST /api/product-images` returns
`fallback: false` for a real image and that its returned `/api/product-images`
URL still serves the stored object after a page reload.
