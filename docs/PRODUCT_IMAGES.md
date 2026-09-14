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

The Worker accepts only the resulting `image/webp`, with a 1.5 MB limit. It
independently validates the RIFF/WebP structure, complete frame chunks, decoded
dimensions, and container length, then hashes the exact bytes. The object is
stored with immutable cache metadata at:

```text
products/<hashed-wallet-prefix>/<random-unguessable-path>/<content-hash>.webp
```

Before issuing a signing challenge, the API checks that this exact object
exists under the authenticated wallet path and that its R2 `contentHash`
metadata matches the hash that will enter the signed product payload.

## Mobile recovery states

The merchant form provides a camera-oriented file picker, preview, remove
action, decode/resize state, byte-upload progress, retry after failure, and
cleanup of abandoned uploads. If R2 is unavailable, the API returns the fixed
repository-controlled `demo-product.svg` and its verified SHA-256 hash. The
merchant sees a fallback notice and can still complete the core signed flow.

## Card-free fallback and optional Cloudflare setup

The default deployment deliberately omits the `PRODUCT_IMAGES` binding and
uses the fixed demo image, because enabling R2 requires a billing profile. This
keeps the hackathon deployment card-free and prevents a nonexistent binding
from blocking the Worker deployment.

If R2 is enabled later, create the buckets with:

```powershell
node --use-system-ca node_modules\wrangler\bin\wrangler.js r2 bucket create nimtrace-images-preview
node --use-system-ca node_modules\wrangler\bin\wrangler.js r2 bucket create nimtrace-images
```

Then add a `PRODUCT_IMAGES` R2 binding for `nimtrace-images`, with
`nimtrace-images-preview` as its preview bucket. The application code already
detects the binding and switches from fallback to real object storage without
any other code change.
