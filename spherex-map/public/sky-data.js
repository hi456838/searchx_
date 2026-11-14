export const surveyRoot = 'https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube';
export const references = [
  { id: 'M 42', name: 'Orion Nebula', ra: 83.82208, dec: -5.39111, fov: 2, description: 'A nearby emission nebula and region of active star formation.', source: 'SIMBAD' },
  { id: 'M 31', name: 'Andromeda Galaxy', ra: 10.684708, dec: 41.26875, fov: 4, description: 'A large spiral galaxy in the Local Group.', source: 'SIMBAD' },
  { id: 'M 101', name: 'Pinwheel Galaxy', ra: 210.80227, dec: 54.34895, fov: 2, description: 'A face-on spiral galaxy in Ursa Major. The coordinates are the target position in the IRSA cutout tutorial.', source: 'IRSA / NED', url: 'https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts/' },
];

export function parseProperties(raw) {
  const values = Object.fromEntries(raw.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([\w_]+)\s*=\s*(.*?)\s*$/);
    return match ? [[match[1], match[2]]] : [];
  }));
  const wavelengths = values.data_cube_crval3_arr?.split(/\s+/).map(Number);
  if (!wavelengths || values.data_cube_bunit3 !== 'um' || wavelengths.length !== 102 ||
      Number(values.hips_cube_depth) !== wavelengths.length ||
      wavelengths.some((value, index) => !Number.isFinite(value) || value <= (wavelengths[index - 1] ?? 0))) {
    throw new Error('Unexpected IRSA wavelength metadata.');
  }
  return wavelengths;
}

export function coordinates(input) {
  const pair = input.trim().replaceAll('−', '-').split(/\s*,\s*|\s+/);
  if (pair.length !== 2) return null;
  const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  const sexagesimal = /^[+-]?\d+:\d{1,2}:\d{1,2}(?:\.\d+)?$/;
  const angles = pair.map((value, index) => {
    if (decimal.test(value)) return Number(value);
    if (!sexagesimal.test(value)) return NaN;
    const [whole, minutes, seconds] = value.replace(/^[+-]/, '').split(':').map(Number);
    if (minutes >= 60 || seconds >= 60) return NaN;
    return (value.startsWith('-') ? -1 : 1) * (whole + minutes / 60 + seconds / 3600) * (index === 0 ? 15 : 1);
  });
  const [ra, dec] = angles;
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || ra < 0 || ra >= 360 || Math.abs(dec) > 90) {
    throw new Error('Use RA from 0° to <360° and Dec from −90° to +90°. For sexagesimal use HH:MM:SS ±DD:MM:SS.');
  }
  return angles;
}
