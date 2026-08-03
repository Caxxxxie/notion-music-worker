import test from "node:test";
import assert from "node:assert/strict";
import { appleAlbumId, appleStorefront, baseTitle, cleanAppleTitle, largeArtworkUrl, parseApplePageMetadata, releaseGroupId, reliableMatch } from "../dist-test/music.js";
test("extracts album id and ignores song query",()=>assert.equal(appleAlbumId("https://music.apple.com/us/album/example/123456789?i=987654321"),"123456789"));
test("extracts Apple storefront",()=>assert.equal(appleStorefront("https://music.apple.com/cn/album/example/123456789"),"cn"));
test("upscales Apple artwork",()=>assert.equal(largeArtworkUrl("https://example.test/image/100x100bb.jpg"),"https://example.test/image/1200x1200bb.jpg"));
test("cleans localized Apple page titles",()=>{
  assert.equal(cleanAppleTitle("Apple\u00a0Music \u4e0aTalking Heads\u7684\u4e13\u8f91\u300aSpeaking In Tongues\u300b"),"Speaking In Tongues");
  assert.equal(cleanAppleTitle("petal by Ariana Grande on Apple Music"),"petal");
  assert.equal(cleanAppleTitle("Apple Music album","https://music.apple.com/cn/album/sgt-peppers-lonely-hearts-club-band-2017-mix/1573250333"),"sgt peppers lonely hearts club band 2017 mix");
});
test("parses Apple page fallback metadata",()=>{
  const html='<meta property="og:title" content="petal — Ariana Grande"><meta property="og:description" content="Listen to petal by Ariana Grande on Apple Music."><meta property="og:image" content="https://example.test/100x100bb.jpg">';
  assert.deepEqual(parseApplePageMetadata(html),{title:"petal",artist:"Ariana Grande",releaseDate:"",collectionType:"Album",artwork:"https://example.test/1200x1200bb.jpg"});
});
test("parses Apple serialized album data",()=>{
  const payload=[{data:{catalog:{id:"1895420874",type:"albums",attributes:{name:"petal",artistName:"Ariana Grande",releaseDate:"2026-07-31",artwork:{url:"https://example.test/{w}x{h}bb.jpg"}}}}}];
  const html=`<script id="serialized-server-data">${JSON.stringify(payload)}</script>`;
  assert.deepEqual(parseApplePageMetadata(html,"1895420874"),{title:"petal",artist:"Ariana Grande",releaseDate:"2026-07-31",collectionType:"Album",artwork:"https://example.test/1200x1200bb.jpg"});
});
test("extracts release group id",()=>assert.equal(releaseGroupId("https://musicbrainz.org/release-group/123e4567-e89b-42d3-a456-426614174000"),"123e4567-e89b-42d3-a456-426614174000"));
test("aligns deluxe title",()=>assert.equal(baseTitle("Album Name (Deluxe Edition)"),"album name"));
test("requires one unique exact match",()=>{const one={id:"x",title:"Blue",artist:"Example",artistId:"a",firstReleaseDate:"2024",primaryType:"Album",score:100};assert.equal(reliableMatch("Blue","Example",[one])?.id,"x");assert.equal(reliableMatch("Blue","Example",[one,{...one,id:"y"}]),null)});
test("allows one unique exact title when Apple omits artist",()=>{const one={id:"x",title:"Speaking in Tongues",artist:"Talking Heads",artistId:"a",firstReleaseDate:"1983",primaryType:"Album",score:100};assert.equal(reliableMatch("Speaking in Tongues","",[one])?.id,"x");assert.equal(reliableMatch("Speaking in Tongues","",[one,{...one,id:"y"}]),null)});
