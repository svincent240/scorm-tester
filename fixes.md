Reloads are two distinct and sequentail steps: close the course completely then start the course. 

There is no need to delete or clear data model json files in the startup or shutdown processes. If we are doing a hard reset, we just skip the loading step. Only excepions are a rotation that shoudl be totally seperate from course startup/shutdown (done at app startup/shutdown). This si for very old data cleanup only. The other exception is the MCP tool that clears the json as a means of hard reset instead of the default resume if json present.

The reload and the close must be eaclty the same. The only difference is a flag that triggers a startup process on the same course AFTER the shutdown has finished completely. 

The reload and close unified process should use the same process as the course. They should act just like the course and call exit with resume.

We have the data model to json every time it shuts down. every time

There is no manipulation of the data model, store the whole object straigt to json. No manipulation on loading it either.

Reload has a hard reset option that sets a flag for hard reset instead of resume

The startup process is always the same. Load the json if it is there. Only skip that if the hard reset flag is true.

The MCP needs to behave exaclty the same. Converge the processes as much as possible. MCP has open, close, and reload. There is a seperate tool to delete json data model to do hard reset.

Sessions don't really matter. We have a new session every time even on reload. The json data model is all that is retained