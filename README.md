# SIEVE Observatory — Homepage V1

A standalone, code-generated ASCII homepage. No build step or external runtime services are required.

Run locally from this directory:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/`. Press `P` for the developer controls; `Escape` closes them. The page respects the system reduced-motion preference. Fonts are bundled under the SIL Open Font License in `fonts/`.

The future Observatory application can be hosted at a separate route and linked from this homepage when it is ready; the current page does not include a placeholder application.
