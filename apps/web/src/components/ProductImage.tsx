import { useState, type ImgHTMLAttributes } from 'react'

interface ProductImageProps {
  alt: string
  className?: string
  decoding?: ImgHTMLAttributes<HTMLImageElement>['decoding']
  fetchPriority?: ImgHTMLAttributes<HTMLImageElement>['fetchPriority']
  loading?: ImgHTMLAttributes<HTMLImageElement>['loading']
  src: string
}

export function ProductImage({
  alt,
  className = '',
  decoding = 'async',
  fetchPriority,
  loading = 'lazy',
  src,
}: ProductImageProps) {
  const [loadedSrc, setLoadedSrc] = useState<string>()
  const [failedSrc, setFailedSrc] = useState<string>()
  const status = failedSrc === src ? 'error' : loadedSrc === src ? 'ready' : 'loading'

  return (
    <div className={`product-image-frame ${className} product-image-frame--${status}`.trim()}>
      {status !== 'error' ? (
        <img
          src={src}
          alt={alt}
          decoding={decoding}
          fetchPriority={fetchPriority}
          loading={loading}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <div className="product-image-fallback" role="img" aria-label={`${alt}. Product image unavailable.`}>
          <span aria-hidden="true">N</span>
          <small>Product image unavailable</small>
        </div>
      )}
      {status === 'loading' && <span className="product-image-loading" aria-hidden="true" />}
    </div>
  )
}
