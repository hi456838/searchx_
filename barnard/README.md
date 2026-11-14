# Barnard’s Star time-lapse

Run the website from the repository root with `npm install` and `npm start`. The existing SPHEREx map and the time-lapse use separate data paths.

Start the Python worker from this directory with Python 3.12:

```sh
python -m pip install -r requirements.txt
python -m uvicorn worker:app --host 127.0.0.1 --port 8000 --workers 1
```

Set `BARNARD_WORKER_URL=http://127.0.0.1:8000` in the environment of the local Node server before starting it. Open /observatory, choose Select region, use Find it on the map, then click the map centre.

For Vercel, build the Dockerfile with this directory as the context on a host that can reach IRSA. Use one instance and mount a persistent writable volume at /data. Set `BARNARD_WORKER_URL` to the worker's HTTPS origin in Vercel's Preview environment and redeploy. The worker runs the job independently of Vercel's request lifecycle and publishes its manifest after all PNGs are written. Restarting the worker preserves completed sequences on the volume. An interrupted job can be regenerated on the next request.

For a cold-cache check, use an empty volume, select Barnard’s Star, and watch the worker logs for the IRSA query and frame downloads. Reopen the player and verify that the same manifest is returned without new downloads. Compare the first, middle, and last frames at a fixed zoom, check that multiple field stars stay in place, and confirm the moving source against the catalog position propagated to each observation date.

Sources: [IRSA NEOWISE Level 1b](https://irsa.ipac.caltech.edu/ibe/docs/wise/neowiser/p1bm_frm/), [pixel masks](https://irsa.ipac.caltech.edu/data/WISE/docs/release/NEOWISE/expsup/sec4_2a.html), and [SIMBAD astrometry](https://simbad.harvard.edu/simbad/sim-id?Ident=Barnard%27s+star). The field is centred at the approximate 2019 position from the J2000 catalog position and proper motion. This propagation is for framing and coverage checks. Rendered brightness is for visual comparison.

The worker tries the IRSA Level 1b image metadata service first. If that service times out or returns a server error, it uses the IRSA NEOWISE single-exposure source catalog to discover exposure IDs in the same field and still downloads the corresponding Level 1b science and mask images.
