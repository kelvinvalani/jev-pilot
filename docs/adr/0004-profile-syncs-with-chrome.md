# The profile syncs with Chrome

The profile is the same on each of the user's browsers. It is stored with Chrome sync, which this extension already uses for the API key. Keeping the profile only on this machine was rejected because the user wants the same answers on their other signed-in browsers. An account on a server was rejected because browser sync already carries the profile.

Chrome sync includes the answers in the user's browser account, and a shared browser profile shares the answers. Sync storage is about 100KB, which is enough for identity and contact answers and their aliases.
