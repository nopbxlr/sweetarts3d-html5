# W3D (Shockwave 3D / Intel IFX v2) format notes

Reverse-engineering notes from the 37 game models in `assets/models/*.w3d`,
cross-referenced against the U3D reference implementation (`$S/u3d`, the direct
descendant of IFX v2). Everything below was verified empirically against the
real files unless marked "hypothesis".

## Container

```
offset  type      value
0       char[4]   "IFX\0"
4       u32 LE    8
8       u32 LE    0x11            (version?)
12      u32 LE    fileSize        (matches actual file size)
16      ...       blocks
```

Blocks: `u32 type`, `u32 dataSize`, `dataSize` bytes, padded to 4-byte
alignment. No metadata size field (unlike U3D's 3-word block headers).
All strings in block payloads are `u16 length + bytes` (latin1, not
null-terminated).

Block IDs are NOT the same as U3D's (e.g. W3D 0xFFFFFF45 = CLOD mesh decl,
whereas U3D 0xFFFFFF45 = shading modifier).

## Block types observed

| type       | meaning |
|------------|---------|
| 0xFFFFFF01 | bookkeeping, 4 bytes (loader progress marker; one precedes each 0x49/0x21 group) |
| 0xFFFFFF02 | bookkeeping, 3 bytes |
| 0xFFFFFF10 | material resource |
| 0xFFFFFF20 | texture declaration |
| 0xFFFFFF21 | texture continuation (JPEG payload) |
| 0xFFFFFF36 | shader (lit-texture shader) |
| 0xFFFFFF45 | CLOD mesh generator declaration |
| 0xFFFFFF47 | mesh auxiliary (unknown; small compressed payload; first u32 after name varies 2..134) |
| 0xFFFFFF48 | mesh summary: `[name][u32 finalResolution][u32 0=minRes][compressed tail]` |
| 0xFFFFFF49 | CLOD progressive mesh continuation (bit-packed; see below) |
| 0xFFFFFF4B | skeleton/bones (snake only) |
| 0xFFFFFF50 | light resource |
| 0xFFFFFF71 | light node |
| 0xFFFFFF72 | model node |
| 0xFFFFFF74 | view node |

## Node blocks (0xFFFFFF72 / 71 / 74) — plain little-endian

```
string  name
string  parentName            ("World")
u16     1                     (unknown; possibly child/parent count)
u8      0x20                  (unknown flags)
f32[16] transform             (row-major TRS matrix; identity in all 37 files)
-- model node (0x72) continues:
string  resourceName          ("Cylinder01 Resource")
string  styleName             ("StyleResource")
u32     shaderCount
string  shaderName × shaderCount   ("DefaultShader")
-- light node (0x71) continues:
string  resourceName          ("DefaultLightResource")
-- view node (0x74) continues:
u32     flags(8), then f32 camera params (near=1.0, far=1000, fov=65,
        0, 0, width=640, height=480, ...), then a second "World"-anchored
        target section (not needed for the port)
```

## Light resource (0xFFFFFF50)

```
string name; u8 type(1); u8 unk(1); f32[4] color RGBA (1,1,1,1);
f32[] params (0, 0, 90.0, 0)
```

## Material (0xFFFFFF10) — plain LE

```
string  name
u32     attributes            (0x3F in all files)
f32[4]  ambient RGBA
f32[4]  diffuse RGBA
f32[4]  specular RGBA
f32[4]  emissive RGBA
f32     shininess
f32     opacity               (JSON stores transparency = 1 - opacity)
```

## Shader (0xFFFFFF36) — plain LE

```
string  name                  (usually same as material name)
u32     flagsA                (0x00000001 untextured, 0x00010003 textured)
u32     flagsB                (0)
string  materialName
-- only if textured (block continues):
string  textureName           ("face1.jpg")
f32     1.0
u8      2 ; u32 1 ; u32 0x3F
f32[16] texture transform (identity)
f32[16] second matrix (identity)
u8      1
```

## Texture declaration (0xFFFFFF20)

```
string name; u8 format(7); u32 width; u32 height; u8 channels(3)
```

## Texture continuation (0xFFFFFF21)

```
string name; u8 seq(1); bytes... raw JPEG (SOI..EOI)
```
A texture's JPEG can span several 0x21 blocks with the same name; concatenate
payloads in file order. All 30 embedded JPEGs in the corpus extract with valid
SOI/EOI markers.

## CLOD mesh declaration (0xFFFFFF45) — plain LE

```
string  name                          ("Cylinder01 Resource")
u32     6                             (constant; field count?)
u32     numShadingGroups              (N; = submesh/shading description count)
repeat N:
  u32   maxPositions                  (per-group author-mesh maximum; the sum
                                       over groups >= finalMaxResolution;
                                       excess = positions shared between
                                       groups / scrubbed by the encoder)
  u32   maxFaces
  u32   maxNormals
  u32   maxTexCoords
  u32   0                             (constant; diffuse/specular count?)
  u32   19 (0x13)                     (constant; meaning unknown)
u32     3                             (number of string lists)
list 1: string "default"       + N shader names
list 2: string <modelName>     + N shader names
list 3: string "StyleResource" + N material names
f32[3]  bounding sphere center
f32     bounding sphere radius
f32     1.0                           (constant)
f32     inverseQuantPosition          (= radius / 512 in every file)
f32     inverseQuantNormal            (0.0068014 constant in every file)
f32     inverseQuantTexCoord          (0.0068014 constant)
f32     inverseQuantDiffuse?          (0.0206865 constant)
f32     inverseQuantSpecular?         (0.0068014 constant)
u32     finalMaxResolution            (= total number of vertex-split updates
                                       = final position count)
```

The IQ assignment beyond position follows U3D's field order
(pos/normal/tex/diffuse/specular) but only position IQ is confirmed by data.

## Progressive mesh — CRACKED via the original encoder binary

A copy of the 2001 Macromedia 3ds Max R4 Shockwave-3D exporter was recovered
from web.archive.org and lives at
`$S/sdk/3ds_max_4_exporter/Exporter/SW3D_Exp.dle` (PE32 x86 DLL, IFX v2 statics
linked in — `CIFXBitStream`, `CIFXAuthorGeomCompiler`, `CIFXMRMAuthor`, …).
The progressive-mesh WRITER was disassembled (capstone; tools in `re/`) and the
0xFFFFFF49 record grammar read directly out of `CIFXWriterModel::…` at file
offset **0x1063e490**. The RTL escape/bit codec matches `bitstream.js` exactly
(same fast-mask/underflow path, same SWAP8 table at rdata 0x106dd5a4).

RE tools (need `$S/re-venv` python with capstone+pefile):
- `re/scan1.py` constants, `re/scan2.py`/`scan3.py` vtable + func map,
  `re/dis.py <addr>` peek, `re/annotate.py <lo> <hi>` labels bitstream calls.
- bitstream vtable base `0x106dd660`; slot 0x50=WriteCompU32, 0x54=WriteCompU16,
  0x58=WriteCompU8, 0x5c/0x60/0x64 = the Read counterparts, 0x14/18/1c=WriteU8/16/32.

### Container layout of a mesh resource (three block types)

```
0xFFFFFF45  declaration   (plain LE, see above)
0xFFFFFF47  SCHEDULE      string name; then a flat compressed-u32 stream on
                          context 1: for each group g (in order) a run of
                          maxTexCoords[g] resolution DELTAS (cumulative-sum ->
                          the resolution at which each of that group's records
                          fires); terminated by a raw u32 0 + flush.
                          *** count[g] == groups[g].maxTexCoords ***  (exact on
                          all 37 files: sum of runs == number of records).
0xFFFFFF49  RECORD STREAM one IFX bitstream per block; string name; u32
                          numUpdates; then the records. CONTEXTS PERSIST across
                          the records within a block; each 0x49 block starts a
                          fresh bitstream/fresh contexts.
```

Firing order = interleave by resolution: for res = 1,2,…, and for each group in
order, if that group's next scheduled resolution <= res, it fires one record.
(Verified: candy1 order 2,1,0,0,2,1,0,0,… decodes bit-exact; sequential order
does NOT.)

### The record grammar (contexts are the encoder's uACContext* IDs)

For each firing of (resolution, group g), one record:

```
A = cu32(1)   numNewCornerVertices ("bundles")
C = cu32(3)   numFaceUpdates (existing faces whose split-corner is repointed)
B = cu32(2)   numNewFaces
D = cu32(4)   numDistinctFacesReferenced

D distinct-face refs (static-context, sized by CURRENT face count of group g):
   f0      = cuStatic( faceCount )        ; then for k=1..D-1:
   delta   = cuStatic( faceCount - prev ) ; f_k = prev + delta
   (cuStatic = readSymbol(0x400+n): symbol 0 -> escape rawU32, else value-2.)

A bundles, each:
   POSITION:
     pc = cu8(6)                          ; 4 = "root" (predict 0,0,0)
     if pc!=4:  fli = cu32(5)             ; predictor = vert[ face[dface[fli]][pc] ]
     signs = cu8(7)                       ; bit k -> axis k negative
     mx=cu32(8) my=cu32(8) mz=cu32(8)     ; ONE shared context 8
     pos = predictor + signs*(m * iqPosition)
   NORMAL:
     nc = cu8(0xa) ; if nc!=4: cu32(9) ; ns = cu8(0xb) ; qz = cu32(0xc)
     phi = cuStatic( N+1 ), N = trunc( acos(0)/qN * sqrt((1-z)(1+z)) + 0.5 ),
           z = fround(qz*qN) clamped to 1   (spherical-coord normal quantization)
   TEXCOORDS (only if groups[g].maxTexCoords>0; 1 layer observed):
     tc = cu8(0xe) ; if tc!=4: cu32(0xf) ; ts = cu8(0x10)
     mu = cu32(0x11) mv = cu32(0x11)      ; shared context 0x11
     uv = predictor + signs*(m * iqTexCoord)
   BONE WEIGHTS (snake etc.):
     nb = cu32(0x12) ; per k: id=cu32(0x13) ; if k>0: w=cu32(0x14)

C face updates, each:
   if D>0: fli = cu32(0x15) -> face dface[fli]
   corner = cu8(0x16)  (0/1/2)
   rel    = cu32(0x17) ; if rel==0: newVert = rawU32 else newVert = recentVertex(rel)
   oldCode = cu8(0x18) ; if ==3: cu32(...) rare
   -> face[dface[fli]][corner] = newVert

B new faces, each: 3 corner-vertex refs + shading + attr triples
   per corner: code = cu8(0x19)
     0 -> rawU32 abs index
     1 -> cu32(0x1a)  : "recent vertex" relative index
     2/3/4 -> fli=cu32(0x1b), d=cu32(0x1c) : idx = face[dface[fli]][code-2] + d
     5 -> nested predictor (2nd/3rd corner relative to prior corner) -- SEE GAP
   shading = cu8(0x1d)
   3x cu8(0x1e)  (per-corner attribute-present flags)
   per corner attr: code=cu8(0x1f); 0..2 -> cu32(0x22)+cu32(0x23);
     4 -> cu32(0x20)+cuStatic(faceCount); 5 -> cu32(0x20)+cu32(0x21);
     else -> cu32(0x20)+cu32(0x24)
```

Jump tables in the DLL: new-face-vertex code dispatch at text 0x10640854
= [ff10(code0 raw), ff20(code1 0x1a), ff32(codes2-4 0x1b/0x1c), ff32, ff32,
ffc9(code5 nested)]; corner-attr dispatch at 0x10640890.

### Status: 37 / 37 models decode BIT-EXACT (see "COMPLETE" section below)

### Status (historical): 14 / 37 models decode BIT-EXACT (positions+faces == declaration)

exact: atv (7 groups!), beachball, candy, candy1-5, coconut, door, fountain,
greenChewy, rocky, tacks. Their geometry (positions, faces, faceShading, and
normals/uvs/boneWeights where present) is written into
`assets/models3d/<name>.json` under `meshes[0].geometry` (status:"exact").
OBJ sanity-checked: connected, mean edge length << bbox diagonal, positions in
the declared bounding sphere; candy1 is a clean cylinder, door a clean box.

### The ONE remaining gap (blocks the other 23 files)

The B-new-face CORNER-VERTEX predictor codes 2/3/4/5 (and the exact base of the
code-1 "recent vertex" relative index) require reconstructing the U3D-style
vertex->face ADJACENCY and the encoder's min-"distance" corner predictor
(SW3D_Exp.dle 0x1063fd6c…0x1064011x, the nested 2nd/3rd-corner blocks at
0x1063ffe0/0x10640075). Simple meshes never hit codes>=2 so they decode fully;
denser meshes desync at the first predicted corner (symptom in the failing
files: `nf idx X/Y` with X slightly >= vertex count). Implementing the
adjacency + distance predictor exactly as the encoder is the remaining work; the
grammar and all contexts are otherwise fully known, so this is mechanical, not
exploratory. Partial geometry (everything up to the desync) is still written to
JSON with status "partial@recN".

## Tools (added this session)

- `re/*.py`         — x86 disassembly + bitstream-call annotation of SW3D_Exp.dle.
- `mesh.js`         — the production decoder (`decodeMesh(buf)` -> {decl,G,declMatch}).
- `integrate.js`    — decodes every model, merges geometry into models3d/*.json.
- `decode_v3.js` / `explore.js` / `hunt*.js` — record-grammar probes (scratch).
- `bitstream2.js`   — codec-variant sweep harness (used to rule out deviations;
                      the stock `bitstream.js` semantics are correct as-is).

## Earlier (pre-binary) empirical notes — superseded but kept for context
### What is PROVEN about the update records (validated on all 37 files)

Update record i (resolution i -> i+1) begins:

```
[split]  compressed u32, STATIC context 0x400+i (as in U3D; forced 0 / 0 bits
         for i <= 1)
[lead]   UNCOMPRESSED u8 via context8/static-256 - NOT context-coded like U3D.
         Observed values: 4 and 6. Hypothesis: bit flags, 4 = position-only
         record, 6 = position + new faces (6 first appears exactly when the
         first triangle becomes possible, at i==2).
[signs]  UNCOMPRESSED u8; bit0/1/2 = x/y/z negative.
[mx][my][mz]  compressed u32 magnitudes sharing ONE persistent dynamic
         context ("P0"); escapes are raw u32 via 4 context8 byte reads,
         exactly as in U3D's ReadCompressedU32X escape path.
         position = signs applied to (mx,my,mz) * inverseQuantPosition.
```

Evidence:
- Update 0 of ALL 37 files decodes to a position inside (usually exactly ON)
  the declaration's bounding sphere (files like candy1/skate/track1 land on
  the sphere to 4 significant digits — impossible by chance).
- candy1's update 1 is a duplicate seam vertex: all three magnitudes decode as
  symbol HITS of update 0's values on the same context (bit-exact).
- door.w3d (a box) shows repeated magnitude hits of its 3 distinct coordinate
  magnitudes (399/512/92) throughout later updates.
- An exhaustive op-sequence search (beam.js) finds a bit-exact parse spanning
  8 consecutive update boundaries on door.w3d using only: P0 magnitude reads,
  static(2)/static(3) reads (orientation/third-type-like flags), static(48)
  reads (48 = door's finalMaxResolution -> face vertex references are indexed
  by FINAL resolution, not current resolution as in U3D), and small
  compressed-u8 fields.

### What is NOT yet cracked

- The exact grammar of the face section of lead=6 records (fields interleave
  with the magnitudes; U3D's order/contexts do NOT apply: U3D reads counts as
  compressed u16/u32 on dynamic contexts, W3D does something different).
- Whether my/mz of non-duplicate vertices after update 0 stay on P0 (hat's
  update 1 magnitude reads do not decode on P0 nor on any fresh/simple
  context; there is at least one still-unknown field between them).
- Normals/texcoords sections (never observed as decodable separate sections;
  hat u0/u1 contain nothing but the position fields, so normals/uvs are
  either interleaved later or derived).
- Continuation 0x49 blocks do NOT restart with fresh contexts: their opening
  bytes only make sense if the dynamic contexts (and possibly more state)
  persist from the previous block of the same mesh (unlike U3D, where each
  continuation block gets a fresh bitstream and fresh contexts).
- 0xFFFFFF47 payload (name + u32 + short compressed stream).
- The 4 header u32s of 0x49 and the trailing bytes of 0x48.

### Deviations from U3D confirmed so far

| aspect | U3D | W3D (IFX v2) |
|---|---|---|
| block IDs | 0xFFFFFF31/3B/3C for decl/base/progressive | 0xFFFFFF45/47/48/49 |
| block header | type,dataSize,metaDataSize | type,dataSize only |
| declaration | counts + shading descs + quality factors + IQ + skeleton | counts per shading group + shader/material name lists + bounding sphere + IQ + finalRes |
| base mesh | separate base-mesh continuation block | progressive-only from resolution 0 |
| update: split index | compressed u32, static ctx 0x400+i | same (verified) |
| update: color counts | compressed u16 (diffuse, specular) | absent |
| update: position | signs u8 + 3 mags, all compressed on 4 separate dynamic contexts, read AFTER faces | signs + mags read BEFORE faces; lead/signs are UNCOMPRESSED u8; mags share ONE context |
| update: face third-index | static ctx sized by current resolution | static ctx sized by FINAL resolution (evidence: static(48) reads in door) |
| contexts across blocks | fresh per continuation block | persist across a mesh's 0x49 blocks |

## Bones (0xFFFFFF4B, snake.w3d) — plain LE, fully decoded

```
string  resourceName          ("Regroup02 Resource")
u32     boneCount             (9 for snake)
repeat boneCount:
  string  boneName            ("ss3D_rootbone", "joint1".."joint8")
  i32     parentIndex         (-1 for root; parents precede children)
  f32     boneLength
  f32[3]  displacement        (translation from parent)
  f32[4]  rotation            (unit quaternion, (w,x,y,z))
  u32     0                   (constant)
u32[numShadingGroups]  per-group position counts (identical to the
                       declaration's group maxPositions column)
```

Snake: root(disp 0.12,1.13,9.67) -> joint1..joint7 spine chain
(lengths ~3-4, near-identity quats) + joint8 (parent=joint1, offset head).
Simpler than U3D's IFXBoneInfo (no name-based parent refs, no attribute-gated
link/joint sections, no rotation constraints).

## Tools in this directory

- `bitstream.js`  — faithful port of the U3D arithmetic decoder (verified).
- `encoder_test.js` — encoder port + 200-trial random roundtrip fuzz (passes).
- `w3d.js`        — CLI: `node w3d.js <file.w3d> <outdir>`; parses everything
                    above, extracts JPEGs to `<outdir>/tex/`, writes JSON.
- `clod.js`       — U3D-semantics progressive decoder (kept for reference;
                    W3D's stream deviates as documented above).
- `beam.js`       — exhaustive op-sequence search over record structure.
- `mitm.js`       — encode-forward/compare-bits search from a known state.
- `dump.js`, `step.js`, `probe.js`, `runprobe.js` — archaeology utilities.

## Status / recommendation

Scene graph, transforms, materials, shaders, texture metadata and all embedded
JPEGs are fully decoded for all 37 files (`assets/models3d/*.json`, `tex/`).
Mesh geometry (positions/faces/normals/uvs) is NOT yet decodable: the
remaining unknown is the face-section grammar of the 0x49 update records.
Until that is cracked, use the Director-based converter
(tomysshadow/Shockwave-3D-World-Converter, runs under Wine) for geometry and
merge with the JSON from this parser for nodes/materials/textures.


## COMPLETE — all 37 models decode (2026-08-11 session)

Five root causes separated the original 14 from 37/37; all fixed in `mesh.js`
(+ one in `bitstream.js`):

1. **C-loop oldCode==3 payload is a RAW u32**, not a compressed read
   (writer 0x1063fcf9 calls vtbl+0x1c = WriteU32). Reading cu32(0x19) there
   polluted the corner-code context and desynced dense meshes.
2. **The encoder's mirror mesh LAGS one record for predictor resolution.**
   Before writing the record at res r the writer calls SetResolution(r-1);
   at that state the C face-updates of the record that created the last
   vertex (res r-1) are NOT yet applied. So ALL predictor lookups (bundle
   position/tex `pc`/`tc` corners and new-face corner codes 2..4) must
   resolve against a topology where the previous record's C-updates are
   still pending (only when that record sits at res r-1; a res gap >= 2
   means they are applied). New faces enter this "mirror" with their
   creation corner values immediately. Decoder keeps a shadow
   `mirror[g].faces` + a one-record `pending` C-update set. This fixed the
   silent connectivity corruption in the original 14 (candy1 cylinder now
   watertight-up-to-seams: band bnd=32+2seam, caps bnd=16; track4 closed
   bnd=0; letters' side-band boundary == front+back outlines).
3. **Static contexts above the codec range fall back to RAW.** cuS must
   mirror WriteCompressedU32: if 0x400+n >= ACMaxRange (0x43FF) the value
   is a raw u32 (no symbol). Hit by track3, whose quantizers are much finer
   (iqPos = radius/2^18, iqN=iqT=2^-14) so the phi static context size
   N+1 ≈ 21917 exceeds 0x3FFF. (Also: magnitude sanity guards must scale
   with 1/iq — track3 position magnitudes legitimately exceed 2^18.)
4. **Escape AddSymbol wraps as u32.** After an escaped value v the codec
   does AddSymbol(v+1) on a 32-bit uint: v=0xFFFFFFFF wraps to
   AddSymbol(0), incrementing the ESCAPE count. The JS port skipped the add
   (guard v+1 > 0xFFFF), diverging the histogram. Hit by urchin, whose
   degenerate spike normals make the encoder's ftol produce qz=0xFFFFFFFF
   (z then clamps to 1.0, s=0, N=0, phi = escape+raw32(0) on the 1-symbol
   static context 0x401). Guards must ACCEPT huge qz.
5. **Block boundaries are exact**: block header u32 after the name is
   numUpdates = the number of RESOLUTION STEPS in the block; a record with
   firing res <= resBase+numUpdates belongs to the block. After the last
   record the writer emits a raw u32 0 + flush (trailing pad).

Additional grammar facts pinned from the disassembly this session:
- dfaces = distinct face indices of the C face-update list, deduped in
  first-appearance order then QSORTED ascending (0x1063e88e), delta-coded
  exactly as implemented (first cuS(faceCount), then cuS(faceCount-prev)).
- New-face corner codes are ONLY 0..4 (no code 5): 0=raw u32, 1=recent
  (idx = vc0 + rel, window = this record's A bundles), 2/3/4 = corner 0/1/2
  of dfaces[cu32(0x1b)] + cu32(0x1c). The corner chosen by the encoder is
  the min unsigned distance target-corner over all dfaces corners (first
  strict minimum wins) — encoder-side only; the decoder needs no adjacency.
- Bundle sections are gated by the per-group flags word (decl field 6,
  0x13 in all 37 files): bit0 positions, bit1 normals, bits4-7 texcoord
  layer count (1 everywhere here).
- Quantizer roles in the normal section (from writer FP code): z uses
  iq[2] (qT slot) and the phi VALUE uses iq[3] (qD slot); the phi CONTEXT
  is 0x400 + 1 + trunc(acos(0)*(1/iqT)*s + 0.5), s = sqrt((1-z)(1+z)),
  z = fround(qz*iqT) clamped to 1. (All files have iqN == iqT, so using qN
  is equivalent in practice.) Tex deltas quantize by iq[1] slot (1/qN).
- Attr code 4's static context is sized by faceCount[g] (incremented per
  appended new face); code 5 delta base is faceCount[g]; codes >= 6 use
  dfaces[code-6] as base. Codes 0..2 = (dface li, fan-depth) pairs.
- urchin: declaration maxPositions over-counts 4 positions that the
  encoder scrubbed (never written, never referenced); the full stream
  parses cleanly with faces matching exactly -> treated as exact
  (`complete` flag in decodeMesh).

Validation: `topocheck.js` decodes all 37 and reports boundary/nonmanifold/
degenerate edge counts, valence, bounding-sphere and face-index bounds.
All 37: 0 out-of-sphere, 0 bad indices, 0 degenerate faces; nonmanifold
edges only where double-sided fins exist by construction (urchin spikes,
sweettarts4 logo). `integrate.js` writes all geometry with status "exact";
`../build-manifest.js` syncs game/assets.
