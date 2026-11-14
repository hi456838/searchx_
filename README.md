# SPHEREx sky map

Run `npm install` and `npm start` in this directory with Node.js 20 or newer. Open [the local sky map](http://127.0.0.1:5173/). Run `npm test` to check coordinate parsing and wavelength labels.

Search for an object or coordinates, select a wavelength, and click a labeled pin to read its catalog details. Return restores the last target. The local server relays the public SPHEREx DR1 tiles from NASA/IPAC IRSA. The viewer uses the official Aladin Lite 3.8.1 release from CDS.

[SPHEREx DR1 data](https://doi.org/10.26131/IRSA679) · [Aladin Lite source and license](https://github.com/cds-astro/aladin-lite/tree/v3.8.1)

The root URL opens the SIEVE Observatory homepage. Follow its link to the SPHEREx sky map at /observatory. The homepage fonts are bundled under the SIL Open Font License in fonts/.
On the homepage, press P to open the developer controls and Escape to close them.
