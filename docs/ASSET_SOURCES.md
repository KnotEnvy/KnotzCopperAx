# Third-party asset sources

External source assets used by the build scripts. Nothing listed here ships as-is: the scripts read them from a
scratch folder OUTSIDE the repo, deform / re-mesh / re-bake them, and only the derived game assets are committed.

| Asset | Version | Source | Licence | Used by | Scratch location |
|---|---|---|---|---|---|
| Blender **Human Base Meshes** bundle (Blender Foundation / Blender Studio) | v1.4.1 (`human-base-meshes-bundle-v1.4.1.zip`, 50 643 039 bytes) | https://www.blender.org/download/demo-files/ (Assets → Human Base Meshes); direct file https://download.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip | CC0 1.0 (public domain, as published on blender.org) | `blender/seraphine_basemesh.py` (mode `export`) appends ONLY the mesh datablock `GEO-body_female_realistic` from `human_base_meshes_bundle.blend`, evaluates Catmull-Clark level 2 and writes `~/kca-assets/human-base-meshes/export/GEO-body_female_realistic.npz`; mode `fit` deforms the head + neck toward Seraphine's references and converts it to a signed-distance grid (`blender/out/seraphine_head_sdf_<mm>.npz`) that `blender/build_hero_seraphine.py` unions into her SDF body (Wave C2 r2). | `~/kca-assets/human-base-meshes/` (zip + `extract/` + `export/`), `~/kca-assets/venv/` (numpy + scipy for the fit) |

Safety rules for `.blend` sources: open / append them with `--factory-startup`, never enable auto-run of Python
scripts (`seraphine_basemesh.py` sets `use_scripts_auto_execute = False`), append mesh data only (no objects,
materials, node groups or text blocks), and keep the downloaded archive out of the repository.
