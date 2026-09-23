function configureInput(input: HTMLInputElement) {
  if (input.type !== 'file') return

  if (input.name === 'cameraImage') {
    input.accept = 'image/*'
    input.setAttribute('capture', 'environment')
    return
  }

  if (input.name === 'uploadImage') {
    input.accept = 'image/*'
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
