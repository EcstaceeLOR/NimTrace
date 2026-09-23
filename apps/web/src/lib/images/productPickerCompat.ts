function configureInput(input: HTMLInputElement) {
  if (input.type !== 'file') return

  if (input.name === 'cameraImage') {
    input.accept = 'image/*'
    input.setAttribute('capture', 'environment')
    return
  }

  if (input.name === 'uploadImage') {
    // Some Android embedded WebViews route any image-only file chooser straight
    // to the camera even without a capture attribute. A generic document
    // chooser keeps Gallery/Photos/Files available; NimTrace still validates
    // the selected file as JPEG/PNG/WebP before any upload occurs.
    input.accept = '*/*'
    input.removeAttribute('capture')
  }
}

export function configureProductImagePickers(root: ParentNode = document) {
  root.querySelectorAll<HTMLInputElement>('input[type="file"][name="cameraImage"], input[type="file"][name="uploadImage"]')
    .forEach(configureInput)
}

export function installProductImagePickerCompatibility() {
  configureProductImagePickers()

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue
        if (node.matches('input[type="file"][name="cameraImage"], input[type="file"][name="uploadImage"]')) {
          configureInput(node as HTMLInputElement)
        }
        configureProductImagePickers(node)
      }
    }
  })

  observer.observe(document.documentElement, { childList: true, subtree: true })
  return () => observer.disconnect()
}
