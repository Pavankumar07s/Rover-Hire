import axios from "axios";
async function main() {
    const res = await axios.post("http://localhost:4001/quote/device/device-id-1234/service/service-srv123", {
        params: {
            room: "100",
            floor: "5",
        },
    });
    console.log("result");
    console.log(res.data);
}
main();
