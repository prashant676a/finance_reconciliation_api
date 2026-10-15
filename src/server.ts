import express from "express";

//create app instance ; object on which we'll config routes/ middlewares
const app = express();

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});
//app.get registers handler for http get requests, /health is url path, req,res= incoming request and response we'll send back
// status 200 ok , serialize to jsona nd send to cient , status: ok is the response data
// (req, res) is callback fxn express runs when request matches this route

app.listen(3000, ()=> {
    console.log("Server running on http://localhost:3000");
})
//starts server listening on port 3000
//callback function runs whenever serveer starts listening