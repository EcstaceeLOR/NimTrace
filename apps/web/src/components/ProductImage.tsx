import { useEffect, useState, type ImgHTMLAttributes } from 'react'

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
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    setStatus('loading')
  }, [src])

  return (
    <div className={`product-image-frame ${className} product-image-frame--${status}`.trim()}>
      {status !== 'error' ? (
        <img
          src={src}
          alt={alt}
          decoding={decoding}
          fetchPriority={fetchPriority}
          loading={loading}
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('error')}
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
