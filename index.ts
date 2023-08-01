import AWS from "aws-sdk";
import {Handler, SQSRecord} from "aws-lambda";

const timestreamWrite = new AWS.TimestreamWrite();

export type Measurement = {
    name: string;
    unit: string | undefined;
    value: number;
};

export type IngressMessage = {
    message: { measurements: Measurement[] };
    clientId: string;
    topic: string;
    timestamp_received: number;
};

export const handler: Handler = async (event, context) => {
    console.log(">>>>> EVENT RECEIVED <<<<<");
    console.log(event);

    const database: string = process.env.DATABASE ?? "";
    const table: string = process.env.TABLE ?? "";

    if (!database || !table) {
        return {
            statusCode: 500,
            body: "Missing Environment Variables!",
        };
    }

    try {
        const records: SQSRecord[] = event.Records;

        const timestreamRecords = records.flatMap((record) => {
            // SELECT * as message, clientId() as clientId, topic() as topic, timestamp() as timestamp_received FROM '#'
            const data: IngressMessage = JSON.parse(record.body);
            const ts = data.timestamp_received;
            const clientId = data.clientId;
            const message = data.message;
            const measurements = message.measurements;

            return measurements.map((m: Measurement) => {
                const dimensions = [
                    {Name: "device_id", Value: clientId},
                    {Name: "sensor_id", Value: m.name},
                ];

                return {
                    Dimensions: dimensions,
                    MeasureName: m.name,
                    MeasureValue: m.value.toString(),
                    MeasureValueType: "DOUBLE",
                    Time: new Date(ts).getTime().toString(),
                };
            });
        });

        // Define the parameters for the Timestream write API
        const params = {
            DatabaseName: database,
            TableName: table,
            Records: timestreamRecords,
        };

        console.log("starting writing to %s.%s", database, table);

        await timestreamWrite.writeRecords(params).promise();

        console.log("done writing to %s.%s", database, table);

        return {
            statusCode: 200,
            body: "Successfully wrote records to Timestream",
        };
    } catch (error) {
        console.log("Error:", error);
        return {
            statusCode: 500,
            body: "Error writing records to Timestream",
        };
    }
};
