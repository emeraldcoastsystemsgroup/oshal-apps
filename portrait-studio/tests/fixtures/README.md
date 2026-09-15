# Face detection fixture

`astronaut.png` is NASA's portrait of Eileen Collins, distributed unchanged by
[scikit-image v0.20.0](https://github.com/scikit-image/scikit-image/blob/v0.20.0/skimage/data/astronaut.png).
Its [dataset documentation](https://scikit-image.org/docs/0.20.x/api/skimage.data.html#skimage.data.astronaut)
identifies the NASA Great Images source and states that it is public domain.
This attribution is independent of the package's maintainer headers and the
detector model's MIT license. No endorsement or identity-recognition claim is made.

The 512×512 PNG is 791,555 bytes, SHA-256
`88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5`.
Browser tests load these local bytes through the real file input and run the
bundled worker/cascade. The expected region surrounds the visible face, not a
mocked detector result. A uniform PNG constructed by the browser is the no-face
fixture. Tests never upload either image or contact an external provider.
