/*
 * Loading-screen memes: Thalaivar one-liners and Jailer-universe gags, rewritten as
 * hash-table jokes. Text only: no film stills are bundled.
 *
 * To add an image meme, put a picture you have the rights to in assets/memes/ and add
 *   { movie: 'Jailer 2', img: 'assets/memes/your-file.jpg', caption: '…' }
 */
(function (global) {
  'use strict';

  global.MEMES = [
    { movie: 'Baashha', emoji: '😎', quote: 'Naan oru thadava sonna, nooru thadava sonna maadhiri.',
      caption: 'The hash function: same code in, same bucket out. Every single time.' },
    { movie: 'Sivaji', emoji: '🦁', quote: 'Singam single-a dhaan varum.',
      caption: 'My link landing in an empty bucket while the linked list checks 32 nodes.' },
    { movie: 'Padayappa', emoji: '🚶', quote: 'En vazhi thani vazhi.',
      caption: 'Linear probing when its home slot is already taken.' },
    { movie: 'Muthu', emoji: '⏱️', quote: 'Naan eppo varuven, epdi varuvenu yaarukkum theriyaadhu.',
      caption: 'The redirect. (It arrives in O(1). Everyone knows.)' },
    { movie: 'Kabali', emoji: '😌', quote: 'Magizhchi.',
      caption: 'The hash table after 2 comparisons. The linked list is still walking.' },
    { movie: 'Enthiran', emoji: '🤖', quote: 'Speed 1 terahertz, memory 1 zettabyte.',
      caption: 'Me introducing my 37-bucket hash table to the examiner.' },
    { movie: 'Petta', emoji: '🔥', quote: 'Paaka thaane poringa, intha Kaali-oda aatatha.',
      caption: 'Collision incoming. Watch separate chaining handle it.' },
    { movie: 'Arunachalam', emoji: '🙏', quote: 'Aandavan solraan, Arunachalam seiyyuraan.',
      caption: 'The hash says bucket 9. The table puts it in bucket 9. No questions asked.' },
    { movie: 'Darbar', emoji: '🚓', quote: 'I am a bad cop.',
      caption: 'Row-level security when you try to delete someone else’s link.' },
    { movie: 'Kabali', emoji: '💪', quote: 'Kabali da!',
      caption: 'The undo stack popping your deleted link straight back.' },
    { movie: 'Jailer', emoji: '🫡', quote: 'Hukum.',
      caption: 'Muthuvel Pandian’s order: no link leaves the chain without a key comparison.' },
    { movie: 'Jailer', emoji: '🔒',
      caption: 'The Jailer of bucket 9. Every chain is under watch. Nobody escapes unhashed.' },
    { movie: 'Jailer 2', emoji: '🐯',
      caption: 'Tiger is back, and so is the table: twice the size, every key re-hashed. Nobody escapes.' },
    { movie: 'Jailer 2', emoji: '🪦',
      caption: 'Muthuvel Pandian inspects the tombstones. Deleted links stay marked; probe chains stay unbroken.' },
    { movie: 'Jailer 2', emoji: '📞',
      caption: 'One phone call from Tiger and the linked list starts walking from the head. Again.' },
  ];
})(window);
