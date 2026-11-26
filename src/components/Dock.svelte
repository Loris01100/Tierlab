<script lang="ts">
  import { TILE_COLORS } from '../lib/constants';
  import { POOL, type Editor } from '../lib/editor.svelte';
  import Icon from './Icon.svelte';
  import Swatches from './Swatches.svelte';
  import Zone from './Zone.svelte';

  let {
    ed,
    onfiles,
    oncatalog,
    ontexts,
    onedit,
    ondelete,
  }: {
    ed: Editor;
    onfiles: (files: FileList) => void;
    oncatalog: () => void;
    ontexts: (text: string) => void;
    onedit: () => void;
    ondelete: () => void;
  } = $props();

  let fileInput: HTMLInputElement;
  let txtInput: HTMLInputElement;
  let txt = $state('');
</script>

<section class="dock" aria-label="Création des vignettes">
  <div class="dock-h">
    <button class="btn pri" onclick={() => fileInput.click()}><Icon name="img" />Importer des images</button>
    <button class="btn" onclick={oncatalog} title="Importer depuis un catalogue (musique, Pokémon, anime, livres…)"><Icon name="search" />Catalogues</button>
    <input
      bind:this={fileInput}
      type="file"
      accept="image/*"
      multiple
      hidden
      onchange={(e) => {
        if (e.currentTarget.files) onfiles(e.currentTarget.files);
        e.currentTarget.value = '';
      }}
    />
    <form
      class="txtform"
      onsubmit={(e) => {
        e.preventDefault();
        if (txt.trim()) ontexts(txt);
        txt = '';
        txtInput.focus();
      }}
    >
      <input
        bind:this={txtInput}
        bind:value={txt}
        class="txt"
        type="text"
        placeholder="Texte de la vignette (virgules = plusieurs)"
        aria-label="Texte de la vignette"
        autocomplete="off"
        maxlength="400"
      />
      <button class="btn" type="submit"><Icon name="plus" />Texte</button>
    </form>
    <Swatches colors={TILE_COLORS} bind:value={ed.textColor} mix label="Couleur des vignettes texte" />
  </div>
  <div class="poolwrap">
    <Zone
      {ed}
      zone={POOL}
      ids={ed.pool}
      class="pool"
      label="Réserve de vignettes"
      empty="Réserve vide : importez, glissez ou collez (Ctrl+V) des images, ou tapez du texte ci-dessus."
    />
    <div class="trash" class:over={ed.overTrash} aria-label="Corbeille"><Icon name="trash" />Supprimer</div>
  </div>
  <div class="foot2">
    <button class="btn" disabled={!ed.selId} onclick={onedit}>Modifier la sélection</button>
    <button class="btn" disabled={!ed.selId} onclick={ondelete}>Supprimer</button>
    <p class="help">
      Glissez les vignettes dans les rangs, ou cliquez une vignette puis un rang. Au clavier : <kbd>1</kbd>–<kbd>9</kbd> classe la
      sélection (<kbd>0</kbd> = réserve) et passe à la suivante. Double-clic pour modifier ou écrire un texte sous une image,
      <kbd>Suppr</kbd>, <kbd>Ctrl</kbd>+<kbd>Z</kbd>. Cliquez le nom d’un rang pour le renommer.
    </p>
  </div>
</section>
