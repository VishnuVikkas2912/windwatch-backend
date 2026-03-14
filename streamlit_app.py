import streamlit as st
import pandas as pd
from app import analyze

st.title("🌬 Wind Turbine Monitoring Dashboard")

uploaded_file = st.file_uploader("Upload turbine CSV", type="csv")

if uploaded_file:
    df = pd.read_csv(uploaded_file)

    result = analyze(df,{
        "companyName":"Demo Company",
        "location":"India",
        "turbineId":"T001",
        "turbineModel":"Model X"
    })

    st.subheader("Health Score")
    st.metric("Health Score", result["health_summary"]["health_score"])

    st.subheader("Power Statistics")
    st.write(result["power_stats"])

    st.subheader("Fault Analysis")
    st.write(result["fault_analysis"])

    st.subheader("Recommendations")

    for r in result["recommendations"]:
        st.write(r)